import * as vscode from 'vscode';
import { GoplsProvider, GoplsTypeInfo } from './goplsProvider';
import { GoFile, GoFileParser, GoStruct, GoInterface } from './goFileParser';
import { GoType } from './goParser';

/**
 * Resolved type with full structural information
 */
export interface ResolvedType {
    /** Type info from gopls hover */
    typeInfo: GoplsTypeInfo;
    /** Location of the type definition */
    location?: vscode.Location;
    /** URI of the source file containing the type */
    sourceUri?: string;
    /** Parsed Go file containing the type */
    goFile?: GoFile;
    /** If this is a struct, the parsed struct */
    struct?: GoStruct;
    /** If this is an interface, the parsed interface */
    iface?: GoInterface;
    /** Full import path for the package */
    importPath?: string;
}

/**
 * Cache entry for resolved types
 */
interface TypeResolutionCacheEntry {
    resolved: ResolvedType;
    timestamp: number;
}

/**
 * Centralized LSP-based type resolution service.
 * Uses gopls to follow type definitions across files and packages,
 * parse defining files, and extract structural information.
 */
export class LspTypeResolver {
    private static readonly TTL_MS = 5 * 60 * 1000; // 5 minute cache TTL
    
    /** Cache: position key -> Location */
    private definitionCache = new Map<string, vscode.Location>();
    
    /** Cache: URI -> parsed GoFile */
    private goFileCache = new Map<string, GoFile>();
    
    /** Cache: "uri#TypeName" -> ResolvedType */
    private typeResolutionCache = new Map<string, TypeResolutionCacheEntry>();

    /**
     * Resolve a type at a specific position in a document.
     * Uses gopls to get hover info and follows type definitions to other files.
     */
    async resolveAtPosition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<ResolvedType | undefined> {
        const hover = await GoplsProvider.getHoverInfo(document, position);
        if (!hover) {
            return undefined;
        }

        const typeInfo = GoplsProvider.parseHoverContent(hover);
        
        // Try to get the type definition location
        const location = await this.getTypeDefinition(document, position);
        
        let goFile: GoFile | undefined;
        let struct: GoStruct | undefined;
        let iface: GoInterface | undefined;
        let sourceUri: string | undefined;
        let importPath: string | undefined;

        if (location) {
            sourceUri = location.uri.toString();
            goFile = await this.getGoFile(location.uri);
            
            const typeName = this.extractTypeNameFromSignature(typeInfo.signature);
            if (typeName && goFile) {
                struct = goFile.structs.find(s => s.name === typeName);
                iface = goFile.interfaces.find(i => i.name === typeName);
                
                // Derive import path from package name and file path
                importPath = this.deriveImportPath(location.uri, goFile.packageName);
            }
        }

        return {
            typeInfo,
            location,
            sourceUri,
            goFile,
            struct,
            iface,
            importPath
        };
    }

    /**
     * Resolve a GoType by finding its position in the document and querying gopls.
     * This is useful when you have a GoType but need its full structural information.
     */
    async resolveGoType(
        goType: GoType,
        document: vscode.TextDocument,
        approximatePosition: vscode.Position
    ): Promise<ResolvedType | undefined> {
        // Check cache first
        const cacheKey = this.makeTypeCacheKey(document.uri.toString(), goType.name);
        const cached = this.getFromTypeCache(cacheKey);
        if (cached) {
            return cached;
        }

        // Try to find the exact position of this type in the document
        const typePosition = await this.findTypePosition(document, goType.name, approximatePosition);
        if (!typePosition) {
            return undefined;
        }

        const resolved = await this.resolveAtPosition(document, typePosition);
        if (resolved) {
            this.setTypeCache(cacheKey, resolved);
        }

        return resolved;
    }

    /**
     * Get type definition location for a symbol at position.
     * Caches results to avoid repeated LSP calls.
     */
    async getTypeDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location | undefined> {
        const key = this.makePositionKey(document.uri, position);
        
        if (this.definitionCache.has(key)) {
            return this.definitionCache.get(key);
        }

        const location = await GoplsProvider.getTypeDefinition(document, position);
        if (location) {
            this.definitionCache.set(key, location);
        }

        return location;
    }

    /**
     * Get definition location (for variables, functions, etc.)
     */
    async getDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location | undefined> {
        return GoplsProvider.getDefinition(document, position);
    }

    /**
     * Parse and cache a Go file from a URI.
     */
    async getGoFile(uri: vscode.Uri): Promise<GoFile | undefined> {
        const key = uri.toString();
        
        if (this.goFileCache.has(key)) {
            return this.goFileCache.get(key);
        }

        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const parsed = GoFileParser.parseFile(doc.getText());
            this.goFileCache.set(key, parsed);
            return parsed;
        } catch (error) {
            // File might not be accessible (e.g., stdlib source)
            console.warn(`LspTypeResolver: Could not parse file ${uri.toString()}: ${error}`);
            return undefined;
        }
    }

    /**
     * Get document symbols for a document (useful for finding positions).
     */
    async getDocumentSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );
            return symbols || [];
        } catch {
            return [];
        }
    }

    /**
     * Find a type's position in the document using document symbols or text search.
     */
    async findTypePosition(
        document: vscode.TextDocument,
        typeName: string,
        fallbackPosition: vscode.Position
    ): Promise<vscode.Position | undefined> {
        // First, try document symbols
        const symbols = await this.getDocumentSymbols(document);
        const typeSymbol = this.findSymbolByName(symbols, typeName);
        if (typeSymbol) {
            return typeSymbol.selectionRange.start;
        }

        // Fallback: text search with word boundaries
        const text = document.getText();
        const regex = new RegExp(`\\b${this.escapeRegex(typeName)}\\b`);
        const match = text.match(regex);
        
        if (match && match.index !== undefined) {
            return document.positionAt(match.index);
        }

        return fallbackPosition;
    }

    /**
     * Find a symbol by name in the document symbols tree.
     */
    private findSymbolByName(
        symbols: vscode.DocumentSymbol[],
        name: string
    ): vscode.DocumentSymbol | undefined {
        for (const symbol of symbols) {
            if (symbol.name === name) {
                return symbol;
            }
            // Search children recursively
            const found = this.findSymbolByName(symbol.children, name);
            if (found) {
                return found;
            }
        }
        return undefined;
    }

    /**
     * Extract type name from gopls signature.
     * Handles: "type Foo struct { ... }", "type X interface {...}", etc.
     */
    private extractTypeNameFromSignature(signature: string): string | undefined {
        // Match: type TypeName struct/interface
        const typeMatch = signature.match(/^type\s+(\w+)/);
        if (typeMatch) {
            return typeMatch[1];
        }

        // Match qualified type: package.TypeName
        const qualifiedMatch = signature.match(/(\w+)\.(\w+)/);
        if (qualifiedMatch) {
            return qualifiedMatch[2];
        }

        // Match simple identifier at start
        const simpleMatch = signature.match(/^(\w+)/);
        return simpleMatch?.[1];
    }

    /**
     * Derive import path from URI and package name.
     * This is a heuristic - for accurate results, we'd need go.mod parsing.
     */
    private deriveImportPath(uri: vscode.Uri, packageName: string): string {
        const fsPath = uri.fsPath;
        
        // Look for common Go path patterns
        const srcMatch = fsPath.match(/src\/(.+)\/[^/]+\.go$/);
        if (srcMatch) {
            return srcMatch[1];
        }

        // Look for go/pkg/mod pattern (for dependencies)
        const modMatch = fsPath.match(/go\/pkg\/mod\/(.+)@[^/]+\/(.+)\/[^/]+\.go$/);
        if (modMatch) {
            return `${modMatch[1]}/${modMatch[2]}`;
        }

        // Look for vendor pattern
        const vendorMatch = fsPath.match(/vendor\/(.+)\/[^/]+\.go$/);
        if (vendorMatch) {
            return vendorMatch[1];
        }

        // Fallback to package name
        return packageName;
    }

    /**
     * Invalidate all caches for a document.
     */
    invalidateDocument(uri: string): void {
        // Clear GoFile cache
        this.goFileCache.delete(uri);

        // Clear definition cache entries for this URI
        const prefix = uri + ':';
        for (const key of this.definitionCache.keys()) {
            if (key.startsWith(prefix)) {
                this.definitionCache.delete(key);
            }
        }

        // Clear type resolution cache entries for this URI
        for (const key of this.typeResolutionCache.keys()) {
            if (key.startsWith(uri)) {
                this.typeResolutionCache.delete(key);
            }
        }
    }

    /**
     * Clear all caches.
     */
    clearAllCaches(): void {
        this.definitionCache.clear();
        this.goFileCache.clear();
        this.typeResolutionCache.clear();
    }

    /**
     * Get cache statistics.
     */
    getCacheStats(): {
        definitionCacheSize: number;
        goFileCacheSize: number;
        typeResolutionCacheSize: number;
    } {
        return {
            definitionCacheSize: this.definitionCache.size,
            goFileCacheSize: this.goFileCache.size,
            typeResolutionCacheSize: this.typeResolutionCache.size
        };
    }

    // Helper methods
    
    private makePositionKey(uri: vscode.Uri, position: vscode.Position): string {
        return `${uri.toString()}:${position.line}:${position.character}`;
    }

    private makeTypeCacheKey(uri: string, typeName: string): string {
        return `${uri}#${typeName}`;
    }

    private getFromTypeCache(key: string): ResolvedType | undefined {
        const entry = this.typeResolutionCache.get(key);
        if (!entry) {
            return undefined;
        }

        // Check TTL
        if (Date.now() - entry.timestamp > LspTypeResolver.TTL_MS) {
            this.typeResolutionCache.delete(key);
            return undefined;
        }

        return entry.resolved;
    }

    private setTypeCache(key: string, resolved: ResolvedType): void {
        this.typeResolutionCache.set(key, {
            resolved,
            timestamp: Date.now()
        });
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

/** Singleton instance of the LSP type resolver */
export const lspTypeResolver = new LspTypeResolver();
