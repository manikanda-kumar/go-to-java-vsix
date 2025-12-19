import * as vscode from 'vscode';
import { GoFunctionParser, GoFunction } from './goParser';
import { JavaCodeGenerator, JavaGenerationOptions } from './javaGenerator';
import { GoToJavaHoverProvider } from './hoverProvider';
import { JavaPreviewProvider } from './previewProvider';
import { findFunctionHeader } from './functionLocator';
import * as TreeSitterGoParser from './treeSitterGoParser';
import { TypeEnricher } from './typeEnricher';
import { typeCache } from './typeCache';

export function activate(context: vscode.ExtensionContext) {
    // Register hover provider
    const hoverProvider = vscode.languages.registerHoverProvider(
        { language: 'go', scheme: 'file' },
        new GoToJavaHoverProvider()
    );
    context.subscriptions.push(hoverProvider);

    // Register preview provider
    const previewProvider = new JavaPreviewProvider();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
            JavaPreviewProvider.scheme,
            previewProvider
        )
    );

    // Register language association for java-preview scheme
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((doc) => {
            if (doc.uri.scheme === JavaPreviewProvider.scheme && doc.languageId !== 'java') {
                vscode.languages.setTextDocumentLanguage(doc, 'java');
            }
        })
    );

    // Track active previews for refresh
    const activePreviewUris = new Map<string, vscode.Uri>();

    // Command: Preview file as Java
    context.subscriptions.push(
        vscode.commands.registerCommand('goToJava.previewFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor found');
                return;
            }

            if (editor.document.languageId !== 'go') {
                vscode.window.showErrorMessage('Please open a Go file to preview');
                return;
            }

            const sourceUri = editor.document.uri;
            const previewUri = JavaPreviewProvider.encodePreviewUri(sourceUri);

            // Track this preview
            activePreviewUris.set(sourceUri.toString(), previewUri);

            // Open preview in side-by-side column
            const doc = await vscode.workspace.openTextDocument(previewUri);
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, true);
        })
    );

    // Command: Refresh preview
    context.subscriptions.push(
        vscode.commands.registerCommand('goToJava.refreshPreview', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            const sourceUri = editor.document.uri;
            const previewUri = activePreviewUris.get(sourceUri.toString());

            if (previewUri) {
                previewProvider.update(previewUri);
            }
        })
    );

    // Auto-refresh on save (if configured)
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((doc) => {
            if (doc.languageId === 'go') {
                // Invalidate type cache for this document
                TypeEnricher.invalidateCache(doc.uri.toString());

                const config = vscode.workspace.getConfiguration('goToJava');
                if (config.get('preview.refreshOnSave', true)) {
                    const previewUri = activePreviewUris.get(doc.uri.toString());
                    if (previewUri) {
                        previewProvider.update(previewUri);
                    }
                }
            }
        })
    );

    // Invalidate cache when documents change
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId === 'go') {
                TypeEnricher.invalidateCache(event.document.uri.toString());
            }
        })
    );

    // Command: Convert function (existing functionality)
    const disposable = vscode.commands.registerCommand('goToJava.convertFunction', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }

        const selection = editor.selection;
        let selectedText: string = '';

        const config = vscode.workspace.getConfiguration('goToJava');

        if (selection.isEmpty) {
            const header = findFunctionHeader(
                editor.document,
                selection.start,
                config.get('hover.maxScanLines', 20)
            );

            if (!header) {
                vscode.window.showErrorMessage('Could not locate a Go function near the cursor.');
                return;
            }

            selectedText = header.text;
        } else {
            selectedText = editor.document.getText(selection);
        }

        const parserChoice = config.get<'regex' | 'tree-sitter'>('parser', 'tree-sitter');
        let goFunction = parserChoice === 'tree-sitter'
            ? await TreeSitterGoParser.parseFunction(selectedText)
            : GoFunctionParser.parseFunction(selectedText);
        if (!goFunction) {
            vscode.window.showErrorMessage('Could not parse Go function. Please select a valid function definition.');
            return;
        }

        // Enrich with gopls type information if enabled
        if (config.get('useGoplsEnrichment', true)) {
            const startLine = selection.isEmpty ? selection.start.line : selection.start.line;
            goFunction = await TypeEnricher.enrichGoFunction(goFunction, editor.document, startLine);
        }

        const outputFormat = await vscode.window.showQuickPick([
            { label: 'Method only', description: 'Generate just the Java method' },
            { label: 'Full class', description: 'Generate a complete Java class without Result helper classes' },
            { label: 'Full class with Result', description: 'Generate class with method and Result class for multiple returns' }
        ], {
            placeHolder: 'Choose output format'
        });

        if (!outputFormat) {
            return;
        }

        const options: JavaGenerationOptions = {
            isStatic: true,
            addComments: true,
            handleErrorsAsExceptions: true,
            addLearningHints: true
        };

        let javaCode: string;

        switch (outputFormat.label) {
            case 'Method only':
                javaCode = JavaCodeGenerator.generateJavaMethod(goFunction, options);
                break;
            case 'Full class':
                javaCode = JavaCodeGenerator.generateFullJavaClass(goFunction, 'GoConverter', {
                    ...options,
                    includeResultClass: false
                });
                break;
            case 'Full class with Result':
                javaCode = JavaCodeGenerator.generateFullJavaClass(goFunction, 'GoConverter', {
                    ...options,
                    includeResultClass: true
                });
                break;
            default:
                return;
        }

        const action = await vscode.window.showQuickPick([
            { label: 'Copy to clipboard', description: 'Copy the generated Java code' },
            { label: 'Insert below', description: 'Insert the code below the current line' },
            { label: 'Show in new tab', description: 'Open the code in a new editor tab' }
        ], {
            placeHolder: 'What to do with the generated Java code?'
        });

        if (!action) {
            return;
        }

        switch (action.label) {
            case 'Copy to clipboard':
                await vscode.env.clipboard.writeText(javaCode);
                vscode.window.showInformationMessage('Java code copied to clipboard!');
                break;
            case 'Insert below':
                const insertLine = selection.isEmpty ? selection.start.line + 1 : selection.end.line + 1;
                const insertPosition = new vscode.Position(insertLine, 0);
                await editor.edit(editBuilder => {
                    editBuilder.insert(insertPosition, '\n' + javaCode + '\n');
                });
                vscode.window.showInformationMessage('Java code inserted below!');
                break;
            case 'Show in new tab':
                const document = await vscode.workspace.openTextDocument({
                    content: javaCode,
                    language: 'java'
                });
                await vscode.window.showTextDocument(document);
                break;
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}
