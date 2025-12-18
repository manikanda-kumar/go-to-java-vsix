import * as vscode from 'vscode';
import * as path from 'path';
import { GoFileParser } from './goFileParser';
import { JavaFileGenerator, JavaFileGenerationOptions } from './javaFileGenerator';

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
    provideTextDocumentContent(uri: vscode.Uri): string {
        try {
            // Decode the source file URI from the preview URI
            const sourceUri = this.decodeSourceUri(uri);

            // Read the Go file content
            const goContent = this.readGoFile(sourceUri);

            // Parse the Go file
            const goFile = GoFileParser.parseFile(goContent);

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
        // Create a preview URI that embeds the source file path
        // Format: java-preview://authority/path/to/file.go.java
        const previewPath = sourceUri.path + '.java';
        return vscode.Uri.parse(`${JavaPreviewProvider.scheme}://preview${previewPath}`);
    }

    /**
     * Decode the source URI from a preview URI
     */
    private decodeSourceUri(previewUri: vscode.Uri): vscode.Uri {
        // Extract the original file path from the preview URI
        let filePath = previewUri.path;

        // Remove the .java extension we added
        if (filePath.endsWith('.java')) {
            filePath = filePath.substring(0, filePath.length - 5);
        }

        return vscode.Uri.file(filePath);
    }

    /**
     * Read the content of a Go file
     */
    private readGoFile(uri: vscode.Uri): string {
        const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());

        if (document) {
            // File is already open, use the in-memory content
            return document.getText();
        }

        // File is not open, read from disk
        const fs = require('fs');
        return fs.readFileSync(uri.fsPath, 'utf-8');
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
