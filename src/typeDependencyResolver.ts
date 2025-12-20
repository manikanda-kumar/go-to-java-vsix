import * as vscode from 'vscode';
import { GoType, SourcePosition } from './goParser';
import { GoStruct, GoInterface, GoFile, buildImportAliasMap, resolveQualifiedType } from './goFileParser';
import { LspTypeResolver, ResolvedType, lspTypeResolver } from './lspTypeResolver';

/**
 * A node in the type dependency graph
 */
export interface TypeNode {
    /** The original GoType reference */
    type: GoType;
    /** Resolved struct definition (if this is a struct type) */
    struct?: GoStruct;
    /** Resolved interface definition (if this is an interface type) */
    iface?: GoInterface;
    /** URI of the source file containing this type */
    sourceUri?: string;
    /** Full import path (e.g., "net/http") */
    importPath?: string;
    /** Whether this type is from an external package */
    isExternal: boolean;
    /** Nested type dependencies (fields, method params/returns) */
    dependencies: TypeNode[];
}

/**
 * Result of resolving all type dependencies for a Go file
 */
export interface TypeDependencyGraph {
    /** All resolved type nodes */
    nodes: TypeNode[];
    /** External structs needed for conversion */
    externalStructs: GoStruct[];
    /** External interfaces needed for conversion */
    externalInterfaces: GoInterface[];
    /** Map of type name to resolved node for quick lookup */
    typeMap: Map<string, TypeNode>;
}

/**
 * Options for dependency resolution
 */
export interface ResolutionOptions {
    /** Maximum depth to recurse (default: 3) */
    maxDepth?: number;
    /** Whether to resolve stdlib types (default: false - they get mapped) */
    resolveStdlib?: boolean;
    /** Timeout per LSP call in ms (default: 1000) */
    timeout?: number;
}

/**
 * Known stdlib packages that should be mapped rather than resolved
 */
const STDLIB_PACKAGES = new Set([
    'fmt', 'io', 'os', 'net', 'http', 'context', 'sync', 'time',
    'strings', 'bytes', 'bufio', 'encoding', 'json', 'xml',
    'errors', 'log', 'path', 'filepath', 'regexp', 'sort',
    'strconv', 'unicode', 'crypto', 'hash', 'math', 'reflect'
]);

/**
 * Built-in types that don't need resolution
 */
const BUILTIN_TYPES = new Set([
    'int', 'int8', 'int16', 'int32', 'int64',
    'uint', 'uint8', 'uint16', 'uint32', 'uint64',
    'float32', 'float64', 'bool', 'string', 'rune', 'byte',
    'error', 'interface{}', 'any', 'uintptr', 'complex64', 'complex128'
]);

/**
 * Resolver for building a complete type dependency graph.
 * Follows type definitions across files and packages to collect
 * all struct/interface definitions needed for accurate Java conversion.
 */
export class TypeDependencyResolver {
    private visited = new Set<string>();
    private resolver: LspTypeResolver;

    constructor(resolver?: LspTypeResolver) {
        this.resolver = resolver || lspTypeResolver;
    }

    /**
     * Resolve all type dependencies for a Go file.
     * This walks through all types used in the file and resolves their definitions.
     */
    async resolveFileDependencies(
        goFile: GoFile,
        document: vscode.TextDocument,
        options: ResolutionOptions = {}
    ): Promise<TypeDependencyGraph> {
        this.visited.clear();
        const maxDepth = options.maxDepth ?? 3;
        
        const graph: TypeDependencyGraph = {
            nodes: [],
            externalStructs: [],
            externalInterfaces: [],
            typeMap: new Map()
        };

        const importMap = buildImportAliasMap(goFile);
        const currentUri = document.uri.toString();

        // Collect all types used in the file
        const typesToResolve: Array<{ type: GoType; position?: SourcePosition }> = [];

        // From struct fields
        for (const struct of goFile.structs) {
            for (const field of struct.fields) {
                typesToResolve.push({ type: field.type, position: field.typePosition });
            }
            // From methods
            for (const method of struct.methods) {
                this.collectTypesFromFunction(method, typesToResolve);
            }
        }

        // From interface methods
        for (const iface of goFile.interfaces) {
            for (const method of iface.methods) {
                for (const param of method.parameters) {
                    typesToResolve.push({ type: param.type, position: param.typePosition });
                }
                for (const returnType of method.returnTypes) {
                    typesToResolve.push({ type: returnType, position: returnType.position });
                }
            }
        }

        // From package-level functions
        for (const func of goFile.functions) {
            this.collectTypesFromFunction(func, typesToResolve);
        }

        // From variables and constants
        for (const variable of [...goFile.variables, ...goFile.constants]) {
            if (variable.type) {
                typesToResolve.push({ type: variable.type, position: variable.typePosition });
            }
        }

        // Resolve each type
        for (const { type, position } of typesToResolve) {
            await this.resolveType(
                type,
                document,
                position || { line: 0, character: 0 },
                0,
                maxDepth,
                currentUri,
                importMap,
                graph,
                options
            );
        }

        return graph;
    }

    /**
     * Resolve a single type and its dependencies recursively.
     */
    async resolveTypeDeep(
        type: GoType,
        document: vscode.TextDocument,
        position: SourcePosition,
        options: ResolutionOptions = {}
    ): Promise<TypeNode[]> {
        this.visited.clear();
        const maxDepth = options.maxDepth ?? 3;
        
        const graph: TypeDependencyGraph = {
            nodes: [],
            externalStructs: [],
            externalInterfaces: [],
            typeMap: new Map()
        };

        // Try to get import map from the document
        let importMap = new Map<string, string>();
        try {
            const goFile = await this.resolver.getGoFile(document.uri);
            if (goFile) {
                importMap = buildImportAliasMap(goFile);
            }
        } catch {
            // Ignore - use empty import map
        }

        await this.resolveType(
            type,
            document,
            position,
            0,
            maxDepth,
            document.uri.toString(),
            importMap,
            graph,
            options
        );

        return graph.nodes;
    }

    /**
     * Internal recursive type resolution
     */
    private async resolveType(
        type: GoType,
        document: vscode.TextDocument,
        position: SourcePosition,
        depth: number,
        maxDepth: number,
        currentUri: string,
        importMap: Map<string, string>,
        graph: TypeDependencyGraph,
        options: ResolutionOptions
    ): Promise<void> {
        if (depth > maxDepth) {
            return;
        }

        // Get the base type name (strip pointer, slice prefixes)
        const baseTypeName = this.getBaseTypeName(type);
        
        // Skip built-in types
        if (BUILTIN_TYPES.has(baseTypeName)) {
            return;
        }

        // Create a unique key for this type
        const typeKey = this.makeTypeKey(baseTypeName, type.packagePath, currentUri);
        if (this.visited.has(typeKey)) {
            return;
        }
        this.visited.add(typeKey);

        // Check if this is a qualified type (package.Type)
        const qualified = resolveQualifiedType(baseTypeName, importMap);
        const isExternal = !!qualified || !!type.packagePath;
        
        // Skip stdlib types unless explicitly requested
        if (!options.resolveStdlib && qualified) {
            const pkgName = qualified.packageAlias;
            if (STDLIB_PACKAGES.has(pkgName)) {
                return;
            }
        }

        // Create the type node
        const node: TypeNode = {
            type: { ...type },
            isExternal,
            dependencies: []
        };

        // Try to resolve the type definition via LSP
        try {
            const vscodePosition = new vscode.Position(position.line, position.character);
            const resolved = await this.resolver.resolveAtPosition(document, vscodePosition);

            if (resolved) {
                node.sourceUri = resolved.sourceUri;
                node.importPath = resolved.importPath;

                if (resolved.struct) {
                    node.struct = resolved.struct;
                    node.type.isStruct = true;
                    
                    // Add to external structs if from another file
                    if (resolved.sourceUri && resolved.sourceUri !== currentUri) {
                        if (!graph.externalStructs.some(s => s.name === resolved.struct!.name)) {
                            graph.externalStructs.push(resolved.struct);
                        }
                    }

                    // Recursively resolve field types
                    if (resolved.goFile) {
                        const nestedImportMap = buildImportAliasMap(resolved.goFile);
                        const nestedDoc = resolved.location 
                            ? await vscode.workspace.openTextDocument(resolved.location.uri)
                            : document;

                        for (const field of resolved.struct.fields) {
                            if (field.typePosition) {
                                await this.resolveType(
                                    field.type,
                                    nestedDoc,
                                    field.typePosition,
                                    depth + 1,
                                    maxDepth,
                                    resolved.sourceUri || currentUri,
                                    nestedImportMap,
                                    graph,
                                    options
                                );
                            }
                        }
                    }
                }

                if (resolved.iface) {
                    node.iface = resolved.iface;
                    node.type.isInterface = true;

                    // Add to external interfaces if from another file
                    if (resolved.sourceUri && resolved.sourceUri !== currentUri) {
                        if (!graph.externalInterfaces.some(i => i.name === resolved.iface!.name)) {
                            graph.externalInterfaces.push(resolved.iface);
                        }
                    }

                    // Recursively resolve method parameter/return types
                    if (resolved.goFile) {
                        const nestedImportMap = buildImportAliasMap(resolved.goFile);
                        const nestedDoc = resolved.location
                            ? await vscode.workspace.openTextDocument(resolved.location.uri)
                            : document;

                        for (const method of resolved.iface.methods) {
                            for (const param of method.parameters) {
                                if (param.typePosition) {
                                    await this.resolveType(
                                        param.type,
                                        nestedDoc,
                                        param.typePosition,
                                        depth + 1,
                                        maxDepth,
                                        resolved.sourceUri || currentUri,
                                        nestedImportMap,
                                        graph,
                                        options
                                    );
                                }
                            }
                            for (const returnType of method.returnTypes) {
                                if (returnType.position) {
                                    await this.resolveType(
                                        returnType,
                                        nestedDoc,
                                        returnType.position,
                                        depth + 1,
                                        maxDepth,
                                        resolved.sourceUri || currentUri,
                                        nestedImportMap,
                                        graph,
                                        options
                                    );
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.warn(`TypeDependencyResolver: Failed to resolve type ${baseTypeName}: ${error}`);
        }

        // Handle map types
        if (type.isMap) {
            if (type.keyType) {
                await this.resolveType(
                    type.keyType,
                    document,
                    type.keyType.position || position,
                    depth + 1,
                    maxDepth,
                    currentUri,
                    importMap,
                    graph,
                    options
                );
            }
            if (type.valueType) {
                await this.resolveType(
                    type.valueType,
                    document,
                    type.valueType.position || position,
                    depth + 1,
                    maxDepth,
                    currentUri,
                    importMap,
                    graph,
                    options
                );
            }
        }

        // Add to graph
        graph.nodes.push(node);
        graph.typeMap.set(baseTypeName, node);
    }

    /**
     * Collect types from a function's parameters and return types
     */
    private collectTypesFromFunction(
        func: { parameters: Array<{ type: GoType; typePosition?: SourcePosition }>; returnTypes: GoType[] },
        collection: Array<{ type: GoType; position?: SourcePosition }>
    ): void {
        for (const param of func.parameters) {
            collection.push({ type: param.type, position: param.typePosition });
        }
        for (const returnType of func.returnTypes) {
            collection.push({ type: returnType, position: returnType.position });
        }
    }

    /**
     * Get the base type name without pointer/slice/variadic prefixes
     */
    private getBaseTypeName(type: GoType): string {
        let name = type.name;
        if (name.startsWith('*')) {
            name = name.substring(1);
        }
        if (name.startsWith('[]')) {
            name = name.substring(2);
        }
        if (name.startsWith('...')) {
            name = name.substring(3);
        }
        return name;
    }

    /**
     * Create a unique key for a type
     */
    private makeTypeKey(typeName: string, packagePath?: string, uri?: string): string {
        if (packagePath) {
            return `${packagePath}.${typeName}`;
        }
        if (uri) {
            return `${uri}#${typeName}`;
        }
        return typeName;
    }

    /**
     * Reset the visited set (for reuse)
     */
    reset(): void {
        this.visited.clear();
    }
}

/** Factory function to create a new resolver instance */
export function createTypeDependencyResolver(): TypeDependencyResolver {
    return new TypeDependencyResolver();
}
