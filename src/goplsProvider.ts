import * as vscode from 'vscode';

/**
 * Information extracted from gopls hover response
 */
export interface GoplsTypeInfo {
    /** Full type signature from gopls */
    signature: string;
    /** Whether this type is an interface */
    isInterface: boolean;
    /** Whether this type is a struct */
    isStruct: boolean;
    /** Whether this is a function type */
    isFunction: boolean;
    /** Package path for imported types (e.g., "io" for io.Reader) */
    packagePath?: string;
    /** Documentation/comments if available */
    documentation?: string;
}

/**
 * Provider for gopls (Go Language Server) integration
 * Uses VS Code's built-in LSP commands to query gopls for type information
 */
export class GoplsProvider {
    private static readonly DEFAULT_TIMEOUT = 1000; // 1 second

    /**
     * Check if gopls is available by attempting a simple query
     */
    static async isAvailable(document: vscode.TextDocument): Promise<boolean> {
        try {
            // Try to get hover info at position 0,0 - if gopls is running, this should work
            const hovers = await Promise.race([
                vscode.commands.executeCommand<vscode.Hover[]>(
                    'vscode.executeHoverProvider',
                    document.uri,
                    new vscode.Position(0, 0)
                ),
                new Promise<null>((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 500)
                )
            ]);
            return true; // If we get here without error, gopls is available
        } catch {
            return false;
        }
    }

    /**
     * Get hover information at a specific position
     */
    static async getHoverInfo(
        document: vscode.TextDocument,
        position: vscode.Position,
        timeout?: number
    ): Promise<vscode.Hover | undefined> {
        const timeoutMs = timeout ?? this.getConfiguredTimeout();

        try {
            const hovers = await Promise.race([
                vscode.commands.executeCommand<vscode.Hover[]>(
                    'vscode.executeHoverProvider',
                    document.uri,
                    position
                ),
                new Promise<null>((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), timeoutMs)
                )
            ]);

            if (hovers && hovers.length > 0) {
                return hovers[0];
            }
            return undefined;
        } catch (error) {
            // Timeout or other error - return undefined to trigger fallback
            return undefined;
        }
    }

    /**
     * Get type definition location for a symbol at position
     */
    static async getTypeDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        timeout?: number
    ): Promise<vscode.Location | undefined> {
        const timeoutMs = timeout ?? this.getConfiguredTimeout();

        try {
            const definitions = await Promise.race([
                vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeTypeDefinitionProvider',
                    document.uri,
                    position
                ),
                new Promise<null>((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), timeoutMs)
                )
            ]);

            if (definitions && definitions.length > 0) {
                return definitions[0];
            }
            return undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Get definition location for a symbol at position
     */
    static async getDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        timeout?: number
    ): Promise<vscode.Location | undefined> {
        const timeoutMs = timeout ?? this.getConfiguredTimeout();

        try {
            const definitions = await Promise.race([
                vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeDefinitionProvider',
                    document.uri,
                    position
                ),
                new Promise<null>((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), timeoutMs)
                )
            ]);

            if (definitions && definitions.length > 0) {
                return definitions[0];
            }
            return undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Parse gopls hover content to extract type information
     */
    static parseHoverContent(hover: vscode.Hover): GoplsTypeInfo {
        let fullText = '';

        const contents = hover.contents;
        if (Array.isArray(contents)) {
            fullText = contents
                .map(c => {
                    if (typeof c === 'string') {
                        return c;
                    }
                    // MarkdownString or MarkupContent with value property
                    return (c as vscode.MarkdownString).value || '';
                })
                .join('\n');
        } else if (typeof contents === 'string') {
            fullText = contents;
        } else {
            // MarkdownString or MarkupContent
            fullText = (contents as vscode.MarkdownString).value || '';
        }

        // Extract code block content if present (gopls typically wraps in ```go ... ```)
        const codeBlockMatch = fullText.match(/```go\n([\s\S]*?)```/);
        const signature = codeBlockMatch ? codeBlockMatch[1].trim() : fullText.split('\n')[0].trim();

        // Detect type category from signature
        const isInterface = /^type\s+\w+\s+interface\s*\{/.test(signature) ||
                           signature.includes('interface {');
        const isStruct = /^type\s+\w+\s+struct\s*\{/.test(signature) ||
                        signature.includes('struct {');
        const isFunction = /^func\s/.test(signature);

        // Extract package path from qualified types (e.g., "io.Reader" -> "io")
        let packagePath: string | undefined;
        const qualifiedMatch = signature.match(/([a-z][a-z0-9_]*)\.\w+/i);
        if (qualifiedMatch) {
            packagePath = qualifiedMatch[1];
        }

        // Extract documentation (text after the code block)
        let documentation: string | undefined;
        const afterCodeBlock = fullText.split('```').slice(-1)[0].trim();
        if (afterCodeBlock && !afterCodeBlock.startsWith('go')) {
            documentation = afterCodeBlock;
        }

        return {
            signature,
            isInterface,
            isStruct,
            isFunction,
            packagePath,
            documentation
        };
    }

    /**
     * Get parsed type information at a position
     */
    static async getTypeInfo(
        document: vscode.TextDocument,
        position: vscode.Position,
        timeout?: number
    ): Promise<GoplsTypeInfo | undefined> {
        const hover = await this.getHoverInfo(document, position, timeout);
        if (!hover) {
            return undefined;
        }
        return this.parseHoverContent(hover);
    }

    /**
     * Get the configured timeout from VS Code settings
     */
    private static getConfiguredTimeout(): number {
        const config = vscode.workspace.getConfiguration('goToJava');
        return config.get<number>('goplsTimeout', this.DEFAULT_TIMEOUT);
    }
}
