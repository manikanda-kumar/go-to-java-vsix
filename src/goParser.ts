export interface GoFunction {
    name: string;
    parameters: GoParameter[];
    returnTypes: GoType[];
    isMethod: boolean;
    receiver?: GoParameter;
    hasErrorReturn: boolean;
}

export interface GoParameter {
    name: string;
    type: GoType;
}

export interface GoType {
    name: string;
    isPointer: boolean;
    isSlice: boolean;
    isMap: boolean;
    isVariadic: boolean;
    keyType?: GoType;
    valueType?: GoType;
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
        if (!paramsStr.trim()) {
            return [];
        }

        const params: GoParameter[] = [];
        
        // Parse Go parameters which can be grouped like "a, b int" or separate like "a int, b int"
        const segments = paramsStr.split(',').map(s => s.trim());
        
        // First pass: identify which segments have types
        const segmentsWithTypes = segments.map((segment, index) => {
            const parts = segment.split(/\s+/);
            return {
                index,
                segment,
                hasType: parts.length >= 2,
                name: parts[0],
                type: parts.length >= 2 ? parts.slice(1).join(' ') : ''
            };
        });
        
        // Second pass: group parameters
        let currentType = '';
        let currentNames: string[] = [];
        
        for (const seg of segmentsWithTypes) {
            if (seg.hasType) {
                // Check if the previous segment was a name without type (indicating a group)
                const prevSeg = segmentsWithTypes.find(s => s.index === seg.index - 1);
                
                if (prevSeg && !prevSeg.hasType) {
                    // This is the type for a group that started with previous names
                    currentNames.push(prevSeg.name);
                    currentNames.push(seg.name); // Add current name too
                    currentType = seg.type;
                    
                    // Add all names in the group with this type
                    const type = this.parseType(currentType);
                    for (const name of currentNames) {
                        params.push({ name, type });
                    }
                    currentNames = [];
                    currentType = '';
                } else {
                    // Standalone parameter
                    const type = this.parseType(seg.type);
                    params.push({ name: seg.name, type });
                }
            }
            // Note: we don't need the else case since we handle groups when we encounter the type
        }
        
        // Add any remaining parameters
        if (currentNames.length > 0 && currentType) {
            const type = this.parseType(currentType);
            for (const name of currentNames) {
                params.push({ name, type });
            }
        }

        return params;
    }

    private static parseReturnTypes(returnStr: string): GoType[] {
        const returnTypes: GoType[] = [];
        if (!returnStr.trim()) {
            return returnTypes;
        }

        // Remove leading ':' if present
        const cleanReturnStr = returnStr.startsWith(':') ? returnStr.substring(1).trim() : returnStr;

        // Split by commas for multiple return values
        const returnList = cleanReturnStr.split(',').map(s => s.trim()).filter(s => s);

        for (const returnItem of returnList) {
            const type = this.parseType(returnItem);
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