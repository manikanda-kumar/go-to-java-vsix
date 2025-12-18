import * as vscode from 'vscode';
import { GoFunctionParser, GoFunction } from './goParser';
import { JavaCodeGenerator, JavaGenerationOptions } from './javaGenerator';
import { GoToJavaHoverProvider } from './hoverProvider';
import { JavaPreviewProvider } from './previewProvider';

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

    // Command: Convert function (existing functionality)
    const disposable = vscode.commands.registerCommand('goToJava.convertFunction', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }

        const selection = editor.selection;
        let selectedText: string = '';

        if (selection.isEmpty) {
            let startLine = selection.start.line;
            const currentLine = editor.document.lineAt(startLine).text;
            
            if (!currentLine.trim().startsWith('func')) {
                for (let i = startLine; i >= Math.max(0, startLine - 5); i--) {
                    if (editor.document.lineAt(i).text.trim().startsWith('func')) {
                        startLine = i;
                        break;
                    }
                }
            }
            
            let endLine = startLine;
            let foundOpenBrace = false;
            while (endLine < editor.document.lineCount && !foundOpenBrace) {
                const lineText = editor.document.lineAt(endLine).text;
                if (lineText.includes('{')) {
                    foundOpenBrace = true;
                    const braceIndex = lineText.indexOf('{');
                    const beforeBrace = lineText.substring(0, braceIndex);
                    if (endLine === startLine) {
                        selectedText = beforeBrace.trim();
                    } else {
                        const range = new vscode.Range(startLine, 0, endLine, braceIndex);
                        selectedText = editor.document.getText(range).trim();
                    }
                    break;
                }
                endLine++;
            }
            
            if (!foundOpenBrace) {
                const range = new vscode.Range(startLine, 0, Math.min(startLine + 10, editor.document.lineCount - 1), 0);
                selectedText = editor.document.getText(range).trim();
            }
        } else {
            selectedText = editor.document.getText(selection);
        }

        const goFunction = GoFunctionParser.parseFunction(selectedText);
        if (!goFunction) {
            vscode.window.showErrorMessage('Could not parse Go function. Please select a valid function definition.');
            return;
        }

        const outputFormat = await vscode.window.showQuickPick([
            { label: 'Method only', description: 'Generate just the Java method' },
            { label: 'Full class', description: 'Generate a complete Java class with the method' },
            { label: 'Full class with Result', description: 'Generate class with method and result class for multiple returns' }
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
                javaCode = JavaCodeGenerator.generateFullJavaClass(goFunction, 'GoConverter', options);
                break;
            case 'Full class with Result':
                javaCode = JavaCodeGenerator.generateFullJavaClass(goFunction, 'GoConverter', options);
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