import * as vscode from 'vscode';
import { GoType, GoFunction, GoParameter, GoFunctionParser } from './goParser';
import { GoFile, GoStruct, GoField, GoInterface, GoVariable } from './goFileParser';
import { GoplsProvider, GoplsTypeInfo } from './goplsProvider';
import { typeCache } from './typeCache';

/**
 * Known Go built-in types that don't need gopls enrichment
 */
const BUILTIN_TYPES = new Set([
    'int', 'int8', 'int16', 'int32', 'int64',
    'uint', 'uint8', 'uint16', 'uint32', 'uint64',
    'float32', 'float64',
    'bool', 'string', 'rune', 'byte',
    'error', 'interface{}', 'any',
    'uintptr', 'complex64', 'complex128'
]);

/**
 * Type enricher that combines tree-sitter parsing with gopls semantic information
 */
export class TypeEnricher {
    /**
     * Check if gopls enrichment is enabled in settings
     */
    static isEnrichmentEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('goToJava');
        return config.get<boolean>('useGoplsEnrichment', true);
    }

    /**
     * Check if a type needs enrichment (not a built-in type)
     */
    static needsEnrichment(goType: GoType): boolean {
        if (goType.isResolved) {
            return false;
        }

        // Strip pointer/slice prefixes for checking
        const baseName = goType.name.replace(/^\*/, '');

        // Built-in types don't need enrichment
        if (BUILTIN_TYPES.has(baseName)) {
            return false;
        }

        // Map types: check key and value types
        if (goType.isMap) {
            const needsKeyEnrich = goType.keyType ? this.needsEnrichment(goType.keyType) : false;
            const needsValEnrich = goType.valueType ? this.needsEnrichment(goType.valueType) : false;
            return needsKeyEnrich || needsValEnrich;
        }

        // Unknown/custom types need enrichment
        return true;
    }

    /**
     * Enrich a single GoType with gopls information
     */
    static async enrichType(
        goType: GoType,
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<GoType> {
        if (!this.needsEnrichment(goType)) {
            return { ...goType, isResolved: true };
        }

        const uri = document.uri.toString();

        // Check cache first
        const cached = typeCache.get(uri, position.line, position.character);
        if (cached) {
            return this.applyTypeInfo(goType, cached);
        }

        // Query gopls
        const typeInfo = await GoplsProvider.getTypeInfo(document, position);
        if (!typeInfo) {
            // Gopls unavailable, mark as resolved to prevent retries
            return { ...goType, isResolved: true };
        }

        // Cache the result
        typeCache.set(uri, position.line, position.character, typeInfo);

        return this.applyTypeInfo(goType, typeInfo);
    }

    /**
     * Apply gopls type info to a GoType
     */
    private static applyTypeInfo(goType: GoType, info: GoplsTypeInfo): GoType {
        return {
            ...goType,
            isInterface: info.isInterface,
            isStruct: info.isStruct,
            packagePath: info.packagePath,
            isResolved: true
        };
    }

    /**
     * Enrich a GoFunction with gopls type information
     */
    static async enrichGoFunction(
        goFunc: GoFunction,
        document: vscode.TextDocument,
        functionStartLine: number
    ): Promise<GoFunction> {
        if (!this.isEnrichmentEnabled()) {
            return goFunc;
        }

        // Check if gopls is available
        const isAvailable = await GoplsProvider.isAvailable(document);
        if (!isAvailable) {
            return goFunc;
        }

        const enrichedFunc = { ...goFunc };

        // Enrich parameter types
        enrichedFunc.parameters = await Promise.all(
            goFunc.parameters.map(async (param, index) => {
                // Estimate position for this parameter
                const paramPosition = new vscode.Position(
                    functionStartLine,
                    // Approximate: we'll search for the type in the line
                    0
                );

                // Try to find the actual position of the type in the document
                const line = document.lineAt(functionStartLine).text;
                const typeIndex = this.findTypePosition(line, param.type.name);
                const position = typeIndex >= 0
                    ? new vscode.Position(functionStartLine, typeIndex)
                    : paramPosition;

                return {
                    ...param,
                    type: await this.enrichType(param.type, document, position)
                };
            })
        );

        // Enrich return types
        enrichedFunc.returnTypes = await Promise.all(
            goFunc.returnTypes.map(async (returnType) => {
                const position = new vscode.Position(functionStartLine, 0);
                return this.enrichType(returnType, document, position);
            })
        );

        // Enrich receiver type if method
        if (enrichedFunc.receiver) {
            const position = new vscode.Position(functionStartLine, 0);
            enrichedFunc.receiver = {
                ...enrichedFunc.receiver,
                type: await this.enrichType(enrichedFunc.receiver.type, document, position)
            };
        }

        return enrichedFunc;
    }

    /**
     * Enrich an entire GoFile with gopls type information
     */
    static async enrichGoFile(
        goFile: GoFile,
        document: vscode.TextDocument
    ): Promise<GoFile> {
        if (!this.isEnrichmentEnabled()) {
            return goFile;
        }

        // Check if gopls is available
        const isAvailable = await GoplsProvider.isAvailable(document);
        if (!isAvailable) {
            return goFile;
        }

        const enrichedFile = { ...goFile };

        // Enrich structs
        enrichedFile.structs = await Promise.all(
            goFile.structs.map(s => this.enrichStruct(s, document))
        );

        // Enrich interfaces (mark methods' parameter/return types)
        enrichedFile.interfaces = await Promise.all(
            goFile.interfaces.map(i => this.enrichInterface(i, document))
        );

        // Enrich package-level functions
        enrichedFile.functions = await Promise.all(
            goFile.functions.map(f => this.enrichGoFunction(f, document, 0))
        );

        // Enrich variables
        enrichedFile.variables = await Promise.all(
            goFile.variables.map(v => this.enrichVariable(v, document))
        );

        // Enrich constants
        enrichedFile.constants = await Promise.all(
            goFile.constants.map(c => this.enrichVariable(c, document))
        );

        return enrichedFile;
    }

    /**
     * Enrich a struct with gopls type information
     */
    private static async enrichStruct(
        struct: GoStruct,
        document: vscode.TextDocument
    ): Promise<GoStruct> {
        const enrichedStruct = { ...struct };

        // Enrich field types
        enrichedStruct.fields = await Promise.all(
            struct.fields.map(async (field) => {
                // Find field position in document
                const position = this.findSymbolPosition(document, field.name);
                if (!position) {
                    return field;
                }

                return {
                    ...field,
                    type: await this.enrichType(field.type, document, position)
                };
            })
        );

        // Enrich method types
        enrichedStruct.methods = await Promise.all(
            struct.methods.map(m => this.enrichGoFunction(m, document, 0))
        );

        return enrichedStruct;
    }

    /**
     * Enrich an interface with gopls type information
     */
    private static async enrichInterface(
        iface: GoInterface,
        document: vscode.TextDocument
    ): Promise<GoInterface> {
        const enrichedInterface = { ...iface };

        enrichedInterface.methods = await Promise.all(
            iface.methods.map(async (method) => {
                const enrichedParams = await Promise.all(
                    method.parameters.map(async (param) => ({
                        ...param,
                        type: await this.enrichType(param.type, document, new vscode.Position(0, 0))
                    }))
                );

                const enrichedReturns = await Promise.all(
                    method.returnTypes.map(async (returnType) =>
                        this.enrichType(returnType, document, new vscode.Position(0, 0))
                    )
                );

                return {
                    ...method,
                    parameters: enrichedParams,
                    returnTypes: enrichedReturns
                };
            })
        );

        return enrichedInterface;
    }

    /**
     * Enrich a variable with gopls type information
     */
    private static async enrichVariable(
        variable: GoVariable,
        document: vscode.TextDocument
    ): Promise<GoVariable> {
        if (!variable.type) {
            return variable;
        }

        const position = this.findSymbolPosition(document, variable.name);
        if (!position) {
            return variable;
        }

        return {
            ...variable,
            type: await this.enrichType(variable.type, document, position)
        };
    }

    /**
     * Find the position of a type name within a line
     */
    private static findTypePosition(line: string, typeName: string): number {
        // Handle pointer prefix
        const cleanName = typeName.replace(/^\*/, '');

        // Look for the type name (with word boundaries)
        const regex = new RegExp(`\\b${this.escapeRegex(cleanName)}\\b`);
        const match = line.match(regex);

        return match ? line.indexOf(match[0]) : -1;
    }

    /**
     * Find a symbol's position in the document
     */
    private static findSymbolPosition(
        document: vscode.TextDocument,
        symbolName: string
    ): vscode.Position | undefined {
        const text = document.getText();
        const regex = new RegExp(`\\b${this.escapeRegex(symbolName)}\\b`);
        const match = text.match(regex);

        if (!match || match.index === undefined) {
            return undefined;
        }

        return document.positionAt(match.index);
    }

    /**
     * Escape special regex characters
     */
    private static escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Invalidate cache for a document
     */
    static invalidateCache(uri: string): void {
        typeCache.invalidate(uri);
    }
}
