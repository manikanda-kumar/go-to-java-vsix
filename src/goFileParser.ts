import { GoFunction, GoFunctionParser, GoParameter, GoType, SourcePosition, SourceRange } from './goParser';

export interface GoFile {
    packageName: string;
    imports: GoImport[];
    structs: GoStruct[];
    interfaces: GoInterface[];
    functions: GoFunction[];
    variables: GoVariable[];
    constants: GoConstant[];
}

export interface GoImport {
    alias?: string;
    path: string;
    /** Line number where this import is declared */
    line?: number;
}

export interface GoStruct {
    name: string;
    fields: GoField[];
    methods: GoFunction[];
    /** Position of the struct name in source */
    namePosition?: SourcePosition;
    /** Full range of the struct definition */
    range?: SourceRange;
    /** Embedded types (anonymous fields) */
    embeddedTypes?: GoType[];
}

export interface GoField {
    name: string;
    type: GoType;
    tag?: string;
    exported: boolean;
    /** Position of the field name in source */
    namePosition?: SourcePosition;
    /** Position of the field type in source (for LSP queries) */
    typePosition?: SourcePosition;
    /** Whether this is an embedded/anonymous field */
    isEmbedded?: boolean;
}

export interface GoInterface {
    name: string;
    methods: GoMethodSignature[];
    /** Position of the interface name in source */
    namePosition?: SourcePosition;
    /** Full range of the interface definition */
    range?: SourceRange;
    /** Embedded interfaces */
    embeddedInterfaces?: string[];
}

export interface GoMethodSignature {
    name: string;
    parameters: GoParameter[];
    returnTypes: GoType[];
    /** Position of the method name in source */
    namePosition?: SourcePosition;
}

export interface GoVariable {
    name: string;
    type?: GoType;
    isConst: boolean;
    exported: boolean;
    value?: string;
    /** Position of the variable name in source */
    namePosition?: SourcePosition;
    /** Position of the type in source (for LSP queries) */
    typePosition?: SourcePosition;
}

export type GoConstant = GoVariable;

/**
 * Build a map of import aliases to full import paths.
 * Useful for resolving qualified types like "http.Request" to "net/http.Request"
 */
export function buildImportAliasMap(goFile: GoFile): Map<string, string> {
    const map = new Map<string, string>();
    for (const imp of goFile.imports) {
        // If alias is explicitly specified, use it
        // Otherwise, derive from the last segment of the path
        const alias = imp.alias || imp.path.split('/').pop()!;
        map.set(alias, imp.path);
    }
    return map;
}

/**
 * Resolve a qualified type name (e.g., "http.Request") to its full import path.
 */
export function resolveQualifiedType(typeName: string, importMap: Map<string, string>): {
    packageAlias: string;
    typeName: string;
    fullImportPath: string | undefined;
} | undefined {
    const dotIndex = typeName.indexOf('.');
    if (dotIndex === -1) {
        return undefined; // Not a qualified type
    }
    
    const packageAlias = typeName.substring(0, dotIndex);
    const shortTypeName = typeName.substring(dotIndex + 1);
    const fullImportPath = importMap.get(packageAlias);
    
    return {
        packageAlias,
        typeName: shortTypeName,
        fullImportPath
    };
}

export class GoFileParser {
    /**
     * Parse an entire Go file into structured data
     */
    static parseFile(content: string): GoFile {
        const lines = content.split('\n');
        const goFile: GoFile = {
            packageName: '',
            imports: [],
            structs: [],
            interfaces: [],
            functions: [],
            variables: [],
            constants: []
        };

        let i = 0;
        while (i < lines.length) {
            const line = lines[i].trim();

            // Skip empty lines and comments
            if (!line || line.startsWith('//')) {
                i++;
                continue;
            }

            // Parse package declaration
            if (line.startsWith('package ')) {
                goFile.packageName = this.parsePackage(line);
                i++;
                continue;
            }

            // Parse import statements
            if (line.startsWith('import ')) {
                const { imports, nextLine } = this.parseImports(lines, i);
                goFile.imports.push(...imports);
                i = nextLine;
                continue;
            }

            // Parse type declarations (struct or interface)
            if (line.startsWith('type ')) {
                const result = this.parseTypeDeclaration(lines, i);
                if (result.struct) {
                    goFile.structs.push(result.struct);
                } else if (result.interface) {
                    goFile.interfaces.push(result.interface);
                }
                i = result.nextLine;
                continue;
            }

            // Parse function declarations
            if (line.startsWith('func ')) {
                const { func, nextLine } = this.parseFunction(lines, i);
                if (func) {
                    // Check if this is a method (has receiver)
                    if (func.isMethod && func.receiver) {
                        const receiverTypeName = func.receiver.type.name.replace('*', '');
                        const struct = goFile.structs.find(s => s.name === receiverTypeName);
                        if (struct) {
                            struct.methods.push(func);
                        } else {
                            // Method for unknown struct, add as regular function
                            goFile.functions.push(func);
                        }
                    } else {
                        goFile.functions.push(func);
                    }
                }
                i = nextLine;
                continue;
            }

            // Parse variable declarations
            if (line.startsWith('var ')) {
                const variable = this.parseVariable(line, false);
                if (variable) {
                    goFile.variables.push(variable);
                }
                i++;
                continue;
            }

            // Parse constant declarations
            if (line.startsWith('const ')) {
                const constant = this.parseVariable(line, true);
                if (constant) {
                    goFile.constants.push(constant);
                }
                i++;
                continue;
            }

            i++;
        }

        return goFile;
    }

    /**
     * Parse package declaration
     */
    private static parsePackage(line: string): string {
        const match = line.match(/^package\s+(\w+)/);
        return match ? match[1] : '';
    }

    /**
     * Parse import statements (single or multi-line)
     */
    private static parseImports(lines: string[], startLine: number): { imports: GoImport[], nextLine: number } {
        const imports: GoImport[] = [];
        const line = lines[startLine].trim();

        // Single import: import "path" or import alias "path"
        if (line.includes('"')) {
            const singleMatch = line.match(/^import\s+(?:(\w+)\s+)?"([^"]+)"/);
            if (singleMatch) {
                imports.push({
                    alias: singleMatch[1],
                    path: singleMatch[2]
                });
            }
            return { imports, nextLine: startLine + 1 };
        }

        // Multi-line import block: import ( ... )
        if (line === 'import (') {
            let i = startLine + 1;
            while (i < lines.length) {
                const importLine = lines[i].trim();

                if (importLine === ')') {
                    return { imports, nextLine: i + 1 };
                }

                if (importLine && !importLine.startsWith('//')) {
                    const importMatch = importLine.match(/^(?:(\w+)\s+)?"([^"]+)"/);
                    if (importMatch) {
                        imports.push({
                            alias: importMatch[1],
                            path: importMatch[2]
                        });
                    }
                }
                i++;
            }
        }

        return { imports, nextLine: startLine + 1 };
    }

    /**
     * Parse type declaration (struct or interface)
     */
    private static parseTypeDeclaration(lines: string[], startLine: number): {
        struct?: GoStruct,
        interface?: GoInterface,
        nextLine: number
    } {
        const line = lines[startLine].trim();

        // Check for struct
        const structMatch = line.match(/^type\s+(\w+)\s+struct\s*\{?/);
        if (structMatch) {
            const name = structMatch[1];
            return this.parseStruct(name, lines, startLine);
        }

        // Check for interface
        const interfaceMatch = line.match(/^type\s+(\w+)\s+interface\s*\{?/);
        if (interfaceMatch) {
            const name = interfaceMatch[1];
            return this.parseInterface(name, lines, startLine);
        }

        // Type alias (not supported in MVP)
        return { nextLine: startLine + 1 };
    }

    /**
     * Parse struct definition
     */
    private static parseStruct(name: string, lines: string[], startLine: number): {
        struct: GoStruct,
        nextLine: number
    } {
        // Find the position of the struct name in the first line
        const firstLineText = lines[startLine];
        const nameIndex = firstLineText.indexOf(name);
        
        const struct: GoStruct = {
            name,
            fields: [],
            methods: [],
            embeddedTypes: [],
            namePosition: {
                line: startLine,
                character: nameIndex >= 0 ? nameIndex : 0
            }
        };

        let i = startLine;
        const firstLine = lines[i].trim();
        const structStartLine = startLine;

        // Check if opening brace is on the same line
        if (firstLine.includes('{')) {
            i++;
        } else {
            // Find opening brace
            while (i < lines.length && !lines[i].includes('{')) {
                i++;
            }
            i++;
        }

        // Parse fields until closing brace
        let braceCount = 1;
        while (i < lines.length && braceCount > 0) {
            const line = lines[i].trim();

            if (line.includes('{')) {
                braceCount++;
            }
            if (line.includes('}')) {
                braceCount--;
                if (braceCount === 0) {
                    break;
                }
            }

            // Skip empty lines and comments
            if (!line || line.startsWith('//')) {
                i++;
                continue;
            }

            // Parse field (including embedded fields)
            const field = this.parseField(line, i, lines[i]);
            if (field) {
                if (field.isEmbedded && struct.embeddedTypes) {
                    struct.embeddedTypes.push(field.type);
                }
                struct.fields.push(field);
            }

            i++;
        }

        // Set the full range of the struct
        struct.range = {
            start: { line: structStartLine, character: 0 },
            end: { line: i, character: lines[i]?.length || 0 }
        };

        return { struct, nextLine: i + 1 };
    }

    /**
     * Parse struct field (including embedded/anonymous fields)
     */
    private static parseField(line: string, lineNumber: number, rawLine: string): GoField | null {
        // First, try to match a named field: fieldName type `tag`
        const namedMatch = line.match(/^(\w+)\s+([^\s`]+)(?:\s+`([^`]+)`)?/);
        if (namedMatch) {
            const name = namedMatch[1];
            const typeStr = namedMatch[2];
            const tag = namedMatch[3];

            // Check if field is exported (starts with uppercase)
            const exported = name.charAt(0) === name.charAt(0).toUpperCase();

            // Find positions in the raw line
            const nameIndex = rawLine.indexOf(name);
            const typeIndex = rawLine.indexOf(typeStr, nameIndex + name.length);

            return {
                name,
                type: GoFunctionParser['parseType'](typeStr),
                tag,
                exported,
                isEmbedded: false,
                namePosition: {
                    line: lineNumber,
                    character: nameIndex >= 0 ? nameIndex : 0
                },
                typePosition: {
                    line: lineNumber,
                    character: typeIndex >= 0 ? typeIndex : 0
                }
            };
        }

        // Try to match embedded field: *TypeName or TypeName or package.TypeName
        const embeddedMatch = line.match(/^(\*?)([A-Z]\w*(?:\.\w+)?)(?:\s+`([^`]+)`)?$/);
        if (embeddedMatch) {
            const pointer = embeddedMatch[1];
            const typeName = embeddedMatch[2];
            const tag = embeddedMatch[3];
            const fullTypeName = pointer + typeName;

            // For embedded fields, the name is the type name (without pointer and package prefix)
            const shortName = typeName.includes('.') 
                ? typeName.split('.').pop()! 
                : typeName;

            const exported = shortName.charAt(0) === shortName.charAt(0).toUpperCase();
            const typeIndex = rawLine.indexOf(fullTypeName);

            return {
                name: shortName,
                type: GoFunctionParser['parseType'](fullTypeName),
                tag,
                exported,
                isEmbedded: true,
                namePosition: {
                    line: lineNumber,
                    character: typeIndex >= 0 ? typeIndex : 0
                },
                typePosition: {
                    line: lineNumber,
                    character: typeIndex >= 0 ? typeIndex : 0
                }
            };
        }

        return null;
    }

    /**
     * Parse interface definition
     */
    private static parseInterface(name: string, lines: string[], startLine: number): {
        interface: GoInterface,
        nextLine: number
    } {
        const iface: GoInterface = {
            name,
            methods: []
        };

        let i = startLine;
        const firstLine = lines[i].trim();

        // Check if opening brace is on the same line
        if (firstLine.includes('{')) {
            i++;
        } else {
            // Find opening brace
            while (i < lines.length && !lines[i].includes('{')) {
                i++;
            }
            i++;
        }

        // Parse methods until closing brace
        let braceCount = 1;
        let methodBuffer = '';

        while (i < lines.length && braceCount > 0) {
            const line = lines[i].trim();

            if (line.includes('{')) {
                braceCount++;
            }
            if (line.includes('}')) {
                braceCount--;
                if (braceCount === 0) {
                    break;
                }
            }

            // Skip empty lines and comments
            if (!line || line.startsWith('//')) {
                i++;
                continue;
            }

            // Accumulate method signature (may be multi-line)
            methodBuffer += ' ' + line;

            // Check if we have a complete method signature
            if (line.includes(')') || i === lines.length - 1) {
                const method = this.parseMethodSignature(methodBuffer.trim());
                if (method) {
                    iface.methods.push(method);
                }
                methodBuffer = '';
            }

            i++;
        }

        return { interface: iface, nextLine: i + 1 };
    }

    /**
     * Parse interface method signature
     */
    private static parseMethodSignature(line: string): GoMethodSignature | null {
        // Match: MethodName(params) returnType
        const match = line.match(/^(\w+)\s*\(([^)]*)\)\s*(.*)/);
        if (!match) {
            return null;
        }

        const name = match[1];
        const paramsStr = match[2];
        const returnPart = match[3].trim();

        // Parse parameters using existing logic
        const parameters = GoFunctionParser['parseParameters'](paramsStr);

        // Parse return types
        const returnTypes = GoFunctionParser['parseReturnTypes'](returnPart);

        return {
            name,
            parameters,
            returnTypes
        };
    }

    /**
     * Parse function declaration
     */
    private static parseFunction(lines: string[], startLine: number): {
        func: GoFunction | null,
        nextLine: number
    } {
        let i = startLine;
        let funcText = '';

        // Collect function signature (up to opening brace or end of signature)
        while (i < lines.length) {
            const line = lines[i];
            funcText += line;

            if (line.includes('{')) {
                // Found opening brace, function signature is complete
                // Remove everything after the opening brace
                const braceIndex = funcText.indexOf('{');
                funcText = funcText.substring(0, braceIndex).trim();

                // Skip function body (count braces to find closing brace)
                let braceCount = 1;
                i++;
                while (i < lines.length && braceCount > 0) {
                    if (lines[i].includes('{')) {
                        braceCount++;
                    }
                    if (lines[i].includes('}')) {
                        braceCount--;
                    }
                    i++;
                }
                break;
            }

            i++;
        }

        const func = GoFunctionParser.parseFunction(funcText);
        return { func, nextLine: i };
    }

    /**
     * Parse variable or constant declaration
     */
    private static parseVariable(line: string, isConst: boolean): GoVariable | null {
        // Match: var/const name type = value
        // or: var/const name = value
        const keyword = isConst ? 'const' : 'var';
        const pattern = new RegExp(`^${keyword}\\s+(\\w+)(?:\\s+([^=\\s]+))?(?:\\s*=\\s*(.+))?`);
        const match = line.match(pattern);

        if (!match) {
            return null;
        }

        const name = match[1];
        const typeStr = match[2];
        const value = match[3];

        // Check if variable is exported
        const exported = name.charAt(0) === name.charAt(0).toUpperCase();

        return {
            name,
            type: typeStr ? GoFunctionParser['parseType'](typeStr) : undefined,
            isConst,
            exported,
            value
        };
    }
}
