import * as vscode from 'vscode';
import * as path from 'path';
import { TextDecoder } from 'util';
import { GoFileParser } from './goFileParser';
import { JavaFileGenerator, JavaFileGenerationOptions } from './javaFileGenerator';
import * as TreeSitterGoParser from './treeSitterGoParser';
import { TypeEnricher } from './typeEnricher';

/**
 * Provider for Java preview content
 * Implements VS Code's TextDocumentContentProvider to show Java equivalents of Go files
 */
export class JavaPreviewProvider implements vscode.TextDocumentContentProvider {
    static readonly scheme = 'java-preview';

    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    /**
     * Provide the Java content for a given preview URI
     */
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        try {
            // Decode the source file URI from the preview URI
            const sourceUri = this.decodeSourceUri(uri);

            // Read the Go file content
            const goContent = await this.readGoFile(sourceUri);

            // Parse the Go file (prefer tree-sitter when configured)
            const config = vscode.workspace.getConfiguration('goToJava');
            const parserChoice = config.get<'regex' | 'tree-sitter'>('parser', 'tree-sitter');
            let goFile = parserChoice === 'tree-sitter'
                ? await TreeSitterGoParser.parseFile(goContent)
                : GoFileParser.parseFile(goContent);

            // Enrich with gopls type information if enabled
            if (config.get('useGoplsEnrichment', true)) {
                // Get the source document for enrichment
                const sourceDocument = vscode.workspace.textDocuments.find(
                    doc => doc.uri.toString() === sourceUri.toString()
                );
                if (sourceDocument) {
                    goFile = await TypeEnricher.enrichGoFile(goFile, sourceDocument);
                }
            }

            // Get configuration options
            const options = this.getGenerationOptions(sourceUri);

            // Generate Java code
            const javaCode = JavaFileGenerator.generateJavaFile(goFile, options);

            return javaCode;
        } catch (error) {
            return this.generateErrorContent(error);
        }
    }

    /**
     * Update the preview for a given URI
     */
    update(uri: vscode.Uri) {
        this._onDidChange.fire(uri);
    }

    /**
     * Encode a source Go file URI into a preview URI
     */
    static encodePreviewUri(sourceUri: vscode.Uri): vscode.Uri {
        // Embed the original URI in the query to keep Windows and non-file schemes safe
        const encoded = encodeURIComponent(sourceUri.toString());
        return vscode.Uri.parse(`${JavaPreviewProvider.scheme}://preview?source=${encoded}`);
    }

    /**
     * Decode the source URI from a preview URI
     */
    private decodeSourceUri(previewUri: vscode.Uri): vscode.Uri {
        const query = previewUri.query || '';
        const encoded = query.replace(/^source=/, '');
        return vscode.Uri.parse(decodeURIComponent(encoded));
    }

    /**
     * Read the content of a Go file
     */
    private async readGoFile(uri: vscode.Uri): Promise<string> {
        const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());

        if (document) {
            // File is already open, use the in-memory content
            return document.getText();
        }

        const data = await vscode.workspace.fs.readFile(uri);
        return new TextDecoder('utf-8').decode(data);
    }

    /**
     * Get generation options from VS Code configuration
     */
    private getGenerationOptions(sourceUri: vscode.Uri): JavaFileGenerationOptions {
        const config = vscode.workspace.getConfiguration('goToJava');

        // Derive class name from file name
        const fileName = path.basename(sourceUri.fsPath, '.go');
        const className = fileName.charAt(0).toUpperCase() + fileName.slice(1);

        return {
            isStatic: true,
            addComments: true,
            handleErrorsAsExceptions: true,
            includeConstructors: true,
            includeGettersSetters: config.get('preview.includeGettersSetters', true),
            includeComments: true,
            className: className,
            addLearningHints: true
        };
    }

    /**
     * Generate error content when parsing fails
     */
    private generateErrorContent(error: any): string {
        const errorMessage = error instanceof Error ? error.message : String(error);

        return `/*
 * ERROR: Failed to generate Java preview
 *
 * ${errorMessage}
 *
 * Please ensure:
 * - The Go file has valid syntax
 * - The file is properly formatted
 * - Package declaration is present
 *
 * This is an educational tool that converts Go structures to Java.
 * It may not support all Go language features.
 */

public class ErrorPreview {
    // Preview generation failed
    // See error message above
}
`;
    }
}
