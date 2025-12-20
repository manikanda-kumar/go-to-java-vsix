/** Source position for LSP queries */
export interface SourcePosition {
    line: number;
    character: number;
}

/** Source range for LSP queries */
export interface SourceRange {
    start: SourcePosition;
    end: SourcePosition;
}

export interface GoFunction {
    name: string;
    parameters: GoParameter[];
    returnTypes: GoType[];
    isMethod: boolean;
    receiver?: GoParameter;
    hasErrorReturn: boolean;
    /** Position of the function name in source */
    namePosition?: SourcePosition;
    /** Position of the function start (func keyword) */
    startPosition?: SourcePosition;
    /** Full range of the function signature */
    signatureRange?: SourceRange;
}

export interface GoParameter {
    name: string;
    type: GoType;
    /** Position of the parameter name in source */
    namePosition?: SourcePosition;
    /** Position of the type in source (for LSP queries) */
    typePosition?: SourcePosition;
}

export interface GoType {
    name: string;
    isPointer: boolean;
    isSlice: boolean;
    isMap: boolean;
    isVariadic: boolean;
    keyType?: GoType;
    valueType?: GoType;
    /** Position of this type reference in source (for LSP queries) */
    position?: SourcePosition;
    // Semantic fields (enriched by gopls)
    /** Whether this type is an interface (from gopls) */
    isInterface?: boolean;
    /** Whether this type is a struct (from gopls) */
    isStruct?: boolean;
    /** Package path for imported types (e.g., "io" for io.Reader) */
    packagePath?: string;
    /** Underlying type for type aliases (from gopls) */
    resolvedType?: string;
    /** Whether this type has been enriched by gopls */
    isResolved?: boolean;
    /** Full import path (e.g., "net/http" for http.Request) */
    fullImportPath?: string;
}

/** @deprecated Use SourcePosition instead */
export interface TypeSourcePosition {
    line: number;
    character: number;
}

export class GoFunctionParser {
    private static readonly TYPE_MAP: { [key: string]: string } = {
        'int': 'int',
        'int8': 'byte',
        'int16': 'short',
        'int32': 'int',
        'int64': 'long',
        'uint': 'int',
        'uint8': 'byte',
        'uint16': 'int',
        'uint32': 'long',
        'uint64': 'long',
        'float32': 'float',
        'float64': 'double',
        'bool': 'boolean',
        'string': 'String',
        'rune': 'char',
        'byte': 'byte',
        'error': 'Exception',
        'interface{}': 'Object',
        'any': 'Object'
    };

    private static readonly BOXED_TYPE_MAP: { [key: string]: string } = {
        'int': 'Integer',
        'byte': 'Byte',
        'short': 'Short',
        'long': 'Long',
        'float': 'Float',
        'double': 'Double',
        'boolean': 'Boolean',
        'char': 'Character'
    };

    static parseFunction(text: string): GoFunction | null {
        const cleanText = text.trim();
        if (!cleanText.startsWith('func')) {
            return null;
        }

        // Parse receiver for methods
        const receiverMatch = cleanText.match(/^func\s+\(([^)]+)\)\s+(\w+)/);
        const isMethod = !!receiverMatch;
        let receiver: GoParameter | undefined;

        if (receiverMatch) {
            const receiverParams = this.parseParameters(receiverMatch[1]);
            if (receiverParams.length > 0) {
                receiver = receiverParams[0];
            }
        }

        // Extract function name and parameters
        let afterReceiver: string;
        if (isMethod) {
            afterReceiver = cleanText.substring(receiverMatch![0].length - receiverMatch![2].length);
        } else {
            afterReceiver = cleanText.substring(4); // Remove "func "
        }
        
        // Match function name and parameters more carefully
        const funcMatch = afterReceiver.match(/(\w+)\s*\(([^)]*)\)(.*)/);
        
        if (!funcMatch) {
            return null;
        }

        const name = funcMatch[1];
        const paramsStr = funcMatch[2];
        const returnPart = funcMatch[3].trim();

        // Extract return types
        const returnTypes = this.parseReturnTypes(returnPart);

        const parameters = this.parseParameters(paramsStr);
        const hasErrorReturn = returnTypes.some(t => t.name === 'error');

        return {
            name,
            parameters,
            returnTypes,
            isMethod,
            receiver,
            hasErrorReturn
        };
    }

    private static parseParameters(paramsStr: string): GoParameter[] {
        const trimmed = paramsStr.trim();
        if (!trimmed) {
            return [];
        }

        const params: GoParameter[] = [];
        let pendingNames: string[] = [];

        // Split on commas at top level to respect Go's grouped syntax (a, b, c int)
        const segments = trimmed.split(',').map(s => s.trim()).filter(Boolean);

        for (const segment of segments) {
            const tokens = segment.split(/\s+/).filter(Boolean);
            if (tokens.length === 1) {
                // Only a name so far; type should appear in a later segment
                pendingNames.push(tokens[0]);
                continue;
            }

            // Last token is the type (covers variadic ...T, slices, maps)
            const typeStr = tokens.slice(-1).join(' ');
            const names = [...pendingNames, ...tokens.slice(0, -1)];
            pendingNames = [];

            const type = this.parseType(typeStr);
            for (const name of names) {
                params.push({ name, type });
            }
        }

        // If names are left without a type, we cannot safely infer; drop them
        return params;
    }

    private static parseReturnTypes(returnStr: string): GoType[] {
        const returnTypes: GoType[] = [];
        if (!returnStr.trim()) {
            return returnTypes;
        }

        // Remove leading ':' if present
        let cleanReturnStr = returnStr.startsWith(':') ? returnStr.substring(1).trim() : returnStr.trim();

        // Strip surrounding parentheses for tuple returns e.g. "(int, error)" or "(res int, err error)"
        if (cleanReturnStr.startsWith('(') && cleanReturnStr.endsWith(')')) {
            cleanReturnStr = cleanReturnStr.substring(1, cleanReturnStr.length - 1).trim();
        }

        // Split by commas for multiple return values
        const returnList = cleanReturnStr.split(',').map(s => s.trim()).filter(s => s);

        for (const returnItem of returnList) {
            // Handle named returns: "res int" -> type is last token
            const tokens = returnItem.split(/\s+/).filter(Boolean);
            if (tokens.length === 0) {
                continue;
            }
            const typeToken = tokens[tokens.length - 1];
            const type = this.parseType(typeToken);
            returnTypes.push(type);
        }

        return returnTypes;
    }

    private static parseType(typeStr: string): GoType {
        const trimmed = typeStr.trim();
        
        const isVariadic = trimmed.startsWith('...');
        const isPointer = trimmed.startsWith('*');
        const isSlice = trimmed.startsWith('[]');
        const isMap = trimmed.startsWith('map[');

        let baseType = trimmed;
        if (isVariadic) {
            baseType = baseType.substring(3);
        } else if (isPointer) {
            baseType = baseType.substring(1);
        } else if (isSlice) {
            baseType = baseType.substring(2);
        } else if (isMap) {
            const mapMatch = trimmed.match(/map\[(.+)\](.+)/);
            if (mapMatch) {
                const keyType = this.parseType(mapMatch[1]);
                const valueType = this.parseType(mapMatch[2]);
                return {
                    name: 'Map',
                    isPointer: false,
                    isSlice: false,
                    isMap: true,
                    isVariadic: false,
                    keyType,
                    valueType
                };
            }
        }

        return {
            name: baseType,
            isPointer,
            isSlice: isSlice || isVariadic,
            isMap: false,
            isVariadic
        };
    }

    static convertGoTypeToJava(goType: GoType, needsBoxing: boolean = false): string {
        if (goType.isMap && goType.keyType && goType.valueType) {
            const keyJava = this.convertGoTypeToJava(goType.keyType, true);
            const valueJava = this.convertGoTypeToJava(goType.valueType, true);
            return `Map<${keyJava}, ${valueJava}>`;
        }

        let baseType = this.TYPE_MAP[goType.name] || goType.name;

        if (goType.isSlice) {
            const boxedBase = this.BOXED_TYPE_MAP[baseType] || baseType;
            return `List<${boxedBase}>`;
        }

        if (goType.isPointer) {
            if (baseType === 'String' || baseType === 'Object') {
                return baseType;
            }
            if (this.BOXED_TYPE_MAP[baseType]) {
                return this.BOXED_TYPE_MAP[baseType];
            }
            return baseType;
        }

        if (needsBoxing && this.BOXED_TYPE_MAP[baseType]) {
            return this.BOXED_TYPE_MAP[baseType];
        }

        return baseType;
    }

    static toJavaMethodName(goName: string): string {
        if (goName.length === 0) return goName;
        
        return goName.charAt(0).toLowerCase() + goName.slice(1);
    }

    static toJavaClassName(goName: string): string {
        if (goName.length === 0) return goName;
        
        return goName.charAt(0).toUpperCase() + goName.slice(1);
    }
}
