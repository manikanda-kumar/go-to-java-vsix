import { GoFunction, GoFunctionParser } from './goParser';

export interface JavaGenerationOptions {
    className?: string;
    isStatic: boolean;
    addComments: boolean;
    handleErrorsAsExceptions: boolean;
    addLearningHints?: boolean;
}

export class JavaCodeGenerator {
    static generateJavaMethod(goFunc: GoFunction, options: JavaGenerationOptions = {
        isStatic: true,
        addComments: true,
        handleErrorsAsExceptions: true
    }): string {
        const lines: string[] = [];

        if (options.addComments) {
            lines.push(this.generateJavaDoc(goFunc));
        }

        const signature = this.generateMethodSignature(goFunc, options);
        lines.push(signature);
        lines.push("    // TODO: Implement method logic");
        lines.push(this.generateMethodBody(goFunc, options));

        return lines.join('\n');
    }

    private static generateJavaDoc(goFunc: GoFunction): string {
        const lines: string[] = ['    /**'];
        lines.push(`     * Converted from Go function: ${goFunc.name}`);

        if (goFunc.parameters.length > 0) {
            lines.push('     *');
            for (const param of goFunc.parameters) {
                const javaType = GoFunctionParser.convertGoTypeToJava(param.type);
                lines.push(`     * @param ${param.name} ${this.getParameterDescription(param)}`);
            }
        }

        if (goFunc.returnTypes.length > 0) {
            lines.push('     *');
            if (goFunc.returnTypes.length === 1) {
                const javaType = GoFunctionParser.convertGoTypeToJava(goFunc.returnTypes[0]);
                if (goFunc.returnTypes[0].name !== 'error') {
                    lines.push(`     * @return ${javaType} value`);
                }
            } else {
                lines.push(`     * @return Result object containing multiple return values`);
            }
        }

        if (goFunc.hasErrorReturn) {
            lines.push('     * @throws Exception if operation fails');
        }

        lines.push('     */');
        return lines.join('\n');
    }

    private static getParameterDescription(param: any): string {
        if (param.type.isSlice) {
            return `list of ${param.type.name} values`;
        }
        if (param.type.isMap) {
            return `map with ${param.type.keyType?.name} keys and ${param.type.valueType?.name} values`;
        }
        if (param.type.isPointer) {
            return `${param.type.name} reference`;
        }
        return `${param.type.name} value`;
    }

    private static generateMethodSignature(goFunc: GoFunction, options: JavaGenerationOptions): string {
        const parts: string[] = [];

        if (options.isStatic && !goFunc.isMethod) {
            parts.push('public static');
        } else if (goFunc.isMethod) {
            parts.push('public');
        } else {
            parts.push('public');
        }

        const returnType = this.getReturnType(goFunc, options);
        parts.push(returnType);

        const methodName = GoFunctionParser.toJavaMethodName(goFunc.name);
        const params = this.generateParameterList(goFunc);
        parts.push(`${methodName}(${params})`);

        if (goFunc.hasErrorReturn && options.handleErrorsAsExceptions) {
            parts.push('throws Exception');
        }

        return `    ${parts.join(' ')} {`;
    }

    private static getReturnType(goFunc: GoFunction, options: JavaGenerationOptions): string {
        if (goFunc.returnTypes.length === 0) {
            return 'void';
        }

        // Filter out error types for return type
        const nonErrorTypes = goFunc.returnTypes.filter(t => t.name !== 'error');
        
        if (nonErrorTypes.length === 0) {
            return 'void';
        }

        if (nonErrorTypes.length === 1) {
            return GoFunctionParser.convertGoTypeToJava(nonErrorTypes[0]);
        }

        return this.generateResultClassName(goFunc, options);
    }

    private static generateResultClassName(goFunc: GoFunction, options: JavaGenerationOptions): string {
        if (options.className) {
            return `${options.className}${GoFunctionParser.toJavaClassName(goFunc.name)}Result`;
        }
        return `${GoFunctionParser.toJavaClassName(goFunc.name)}Result`;
    }

    private static generateParameterList(goFunc: GoFunction): string {
        const params: string[] = [];

        for (let i = 0; i < goFunc.parameters.length; i++) {
            const param = goFunc.parameters[i];
            const isLast = i === goFunc.parameters.length - 1;
            
            if (param.type.isVariadic && isLast) {
                const baseType = GoFunctionParser.convertGoTypeToJava(
                    { ...param.type, isSlice: false, isVariadic: false }
                );
                const paramName = this.toJavaParameterName(param.name);
                params.push(`${baseType}... ${paramName}`);
            } else {
                const javaType = GoFunctionParser.convertGoTypeToJava(param.type);
                const paramName = this.toJavaParameterName(param.name);
                params.push(`${javaType} ${paramName}`);
            }
        }

        return params.join(', ');
    }

    private static toJavaParameterName(goName: string): string {
        if (goName.length === 0) return goName;
        return goName.charAt(0).toLowerCase() + goName.slice(1);
    }

    private static generateMethodBody(goFunc: GoFunction, options: JavaGenerationOptions): string {
        const lines: string[] = [];

        if (goFunc.returnTypes.length === 0) {
            if (goFunc.hasErrorReturn && options.handleErrorsAsExceptions) {
                lines.push('    // Handle error case');
                lines.push('    throw new Exception("Not implemented");');
            } else {
                lines.push('    // Method implementation');
            }
        } else if (goFunc.returnTypes.length === 1) {
            const returnType = goFunc.returnTypes[0];
            if (returnType.name === 'error') {
                lines.push('    // Error handling implementation');
                if (options.handleErrorsAsExceptions) {
                    lines.push('    throw new Exception("Not implemented");');
                }
            } else {
                const javaType = GoFunctionParser.convertGoTypeToJava(returnType);
                const defaultValue = this.getDefaultValue(javaType);
                lines.push(`    return ${defaultValue};`);
            }
        } else {
            const resultClass = this.generateResultClassName(goFunc, options);
            lines.push(`    return new ${resultClass}();`);
        }

        lines.push('}');

        return lines.join('\n');
    }

    private static getDefaultValue(javaType: string): string {
        if (javaType === 'int' || javaType === 'long' || javaType === 'short' || javaType === 'byte') {
            return '0';
        }
        if (javaType === 'float' || javaType === 'double') {
            return '0.0';
        }
        if (javaType === 'boolean') {
            return 'false';
        }
        if (javaType === 'char') {
            return "'\\0'";
        }
        if (javaType === 'String') {
            return '""';
        }
        if (javaType.startsWith('List<')) {
            return 'new ArrayList<>()';
        }
        if (javaType.startsWith('Map<')) {
            return 'new HashMap<>()';
        }
        return 'null';
    }

    static generateResultClass(goFunc: GoFunction, options: JavaGenerationOptions = {
        isStatic: true,
        addComments: true,
        handleErrorsAsExceptions: true
    }): string {
        if (goFunc.returnTypes.length <= 1) {
            return '';
        }

        const className = this.generateResultClassName(goFunc, options);
        const lines: string[] = [];

        lines.push(`public static class ${className} {`);

        for (let i = 0; i < goFunc.returnTypes.length; i++) {
            const returnType = goFunc.returnTypes[i];
            if (returnType.name === 'error') continue;

            const javaType = GoFunctionParser.convertGoTypeToJava(returnType);
            const fieldName = `value${i + 1}`;
            lines.push(`    private ${javaType} ${fieldName};`);
        }

        lines.push('');

        for (let i = 0; i < goFunc.returnTypes.length; i++) {
            const returnType = goFunc.returnTypes[i];
            if (returnType.name === 'error') continue;

            const javaType = GoFunctionParser.convertGoTypeToJava(returnType);
            const fieldName = `value${i + 1}`;
            const methodName = `getValue${i + 1}`;

            lines.push(`    public ${javaType} ${methodName}() {`);
            lines.push(`        return ${fieldName};`);
            lines.push('    }');
            lines.push('');

            const setterName = `setValue${i + 1}`;
            lines.push(`    public void ${setterName}(${javaType} ${fieldName}) {`);
            lines.push(`        this.${fieldName} = ${fieldName};`);
            lines.push('    }');

            if (i < goFunc.returnTypes.length - 1) {
                lines.push('');
            }
        }

        lines.push('}');

        return lines.join('\n');
    }

    static generateFullJavaClass(goFunc: GoFunction, className: string = 'GoConverter', options?: JavaGenerationOptions): string {
        const lines: string[] = [];

        lines.push('import java.util.*;');
        lines.push('');
        
        if (options?.addLearningHints) {
            lines.push('/**');
            lines.push(' * Go to Java Conversion Notes:');
            if (goFunc.returnTypes.length > 1) {
                lines.push(' * - Go supports multiple return values; Java uses a Result class to achieve this');
            }
            if (goFunc.hasErrorReturn) {
                lines.push(' * - Go\'s error type is mapped to Java exceptions (throws Exception)');
            }
            if (goFunc.parameters.some(p => p.type.isSlice)) {
                lines.push(' * - Go slices are mapped to Java List<T> (dynamic arrays)');
            }
            if (goFunc.parameters.some(p => p.type.isMap)) {
                lines.push(' * - Go maps are mapped to Java Map<K,V>');
            }
            if (goFunc.parameters.some(p => p.type.isVariadic)) {
                lines.push(' * - Go variadic parameters (...T) are mapped to Java varargs (T...)');
            }
            if (goFunc.parameters.some(p => p.type.isPointer)) {
                lines.push(' * - Go pointers (*T) are mapped to Java objects (all objects are references)');
            }
            lines.push(' */');
        }
        
        lines.push(`public class ${className} {`);
        lines.push('');

        const methodOptions: JavaGenerationOptions = {
            className,
            isStatic: true,
            addComments: true,
            handleErrorsAsExceptions: true,
            addLearningHints: options?.addLearningHints
        };

        lines.push(this.generateJavaMethod(goFunc, methodOptions));
        lines.push('');

        const resultClass = this.generateResultClass(goFunc, methodOptions);
        if (resultClass) {
            lines.push(resultClass);
        }

        lines.push('}');

        return lines.join('\n');
    }
}