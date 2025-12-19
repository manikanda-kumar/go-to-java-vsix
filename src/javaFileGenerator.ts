import { GoFile, GoStruct, GoInterface, GoVariable, GoField } from './goFileParser';
import { GoFunction, GoFunctionParser, GoType } from './goParser';
import { JavaCodeGenerator, JavaGenerationOptions } from './javaGenerator';

export interface JavaFileGenerationOptions extends JavaGenerationOptions {
    packageName?: string;
    className?: string;
    includeConstructors?: boolean;
    includeGettersSetters?: boolean;
    includeComments?: boolean;
}

export class JavaFileGenerator {
    /**
     * Generate a complete Java file from a parsed Go file
     */
    static generateJavaFile(goFile: GoFile, options: JavaFileGenerationOptions = {
        isStatic: true,
        addComments: true,
        handleErrorsAsExceptions: true,
        includeConstructors: true,
        includeGettersSetters: true,
        includeComments: true
    }): string {
        const lines: string[] = [];

        // Determine class name from package name or option
        const className = options.className || this.toJavaClassName(goFile.packageName) || 'GoConverter';

        // Add imports
        lines.push('import java.util.*;');
        lines.push('');

        // Add file-level comment
        if (options.includeComments) {
            lines.push('/**');
            lines.push(` * Converted from Go package: ${goFile.packageName || 'main'}`);
            lines.push(' *');
            lines.push(' * Conversion Notes:');
            lines.push(' * - Go structs → Java inner classes with private fields');
            lines.push(' * - Go interfaces → Java interfaces');
            lines.push(' * - Package-level functions → Static methods');
            lines.push(' * - Package-level variables → Static fields');
            lines.push(' * - Function bodies → TODO stubs (manual implementation needed)');
            lines.push(' *');
            lines.push(' * This is an educational tool to help Java developers understand Go code.');
            lines.push(' * The generated Java is a structural equivalent, not a direct translation.');
            lines.push(' */');
        }

        // Main class declaration
        lines.push(`public class ${className} {`);
        lines.push('');

        // Generate static fields from package variables and constants
        if (goFile.variables.length > 0 || goFile.constants.length > 0) {
            lines.push('    // Package-level variables and constants');
            for (const constant of goFile.constants) {
                const javaField = this.generateStaticField(constant, true);
                lines.push(javaField);
            }
            for (const variable of goFile.variables) {
                const javaField = this.generateStaticField(variable, false);
                lines.push(javaField);
            }
            lines.push('');
        }

        // Generate inner classes from structs
        for (const struct of goFile.structs) {
            const javaClass = this.generateJavaClass(struct, options);
            javaClass.split('\n').forEach(line => {
                lines.push('    ' + line);
            });
            lines.push('');
        }

        // Generate inner interfaces
        for (const iface of goFile.interfaces) {
            const javaInterface = this.generateJavaInterface(iface, options);
            javaInterface.split('\n').forEach(line => {
                lines.push('    ' + line);
            });
            lines.push('');
        }

        // Generate static methods from package-level functions
        if (goFile.functions.length > 0) {
            lines.push('    // Package-level functions');
            for (const func of goFile.functions) {
                const javaMethod = JavaCodeGenerator.generateJavaMethod(func, {
                    ...options,
                    isStatic: true,
                    addComments: true
                });
                javaMethod.split('\n').forEach(line => {
                    lines.push('    ' + line);
                });
                lines.push('');
            }
        }

        lines.push('}');

        return lines.join('\n');
    }

    /**
     * Generate a Java inner class from a Go struct
     */
    private static generateJavaClass(struct: GoStruct, options: JavaFileGenerationOptions): string {
        const lines: string[] = [];

        // Class JavaDoc
        if (options.includeComments) {
            lines.push('/**');
            lines.push(` * Converted from Go struct: ${struct.name}`);
            if (struct.fields.length > 0) {
                lines.push(' *');
                lines.push(' * Fields:');
                for (const field of struct.fields) {
                    const javaType = this.convertTypeToJava(field.type, struct, []);
                    lines.push(` * - ${field.name}: ${javaType}${field.tag ? ` (tag: ${field.tag})` : ''}`);
                }
            }
            lines.push(' */');
        }

        // Class declaration
        lines.push(`public static class ${struct.name} {`);

        // Generate fields
        if (struct.fields.length > 0) {
            lines.push('');
            for (const field of struct.fields) {
                const javaField = this.generateClassField(field, struct, []);
                lines.push('    ' + javaField);
            }
        }

        // Generate default constructor
        if (options.includeConstructors) {
            lines.push('');
            lines.push('    /**');
            lines.push('     * Default constructor');
            lines.push('     */');
            lines.push(`    public ${struct.name}() {}`);
        }

        // Generate getters and setters
        if (options.includeGettersSetters && struct.fields.length > 0) {
            lines.push('');
            for (const field of struct.fields) {
                const getter = this.generateGetter(field, struct, []);
                const setter = this.generateSetter(field, struct, []);
                getter.split('\n').forEach(line => lines.push('    ' + line));
                lines.push('');
                setter.split('\n').forEach(line => lines.push('    ' + line));
                if (field !== struct.fields[struct.fields.length - 1]) {
                    lines.push('');
                }
            }
        }

        // Generate methods (from Go methods with receiver)
        if (struct.methods.length > 0) {
            lines.push('');
            lines.push('    // Methods');
            for (const method of struct.methods) {
                const javaMethod = JavaCodeGenerator.generateJavaMethod(method, {
                    ...options,
                    isStatic: false,
                    addComments: true
                });
                javaMethod.split('\n').forEach(line => {
                    lines.push('    ' + line);
                });
                lines.push('');
            }
        }

        lines.push('}');

        return lines.join('\n');
    }

    /**
     * Generate a Java interface from a Go interface
     */
    private static generateJavaInterface(iface: GoInterface, options: JavaFileGenerationOptions): string {
        const lines: string[] = [];

        // Interface JavaDoc
        if (options.includeComments) {
            lines.push('/**');
            lines.push(` * Converted from Go interface: ${iface.name}`);
            lines.push(' */');
        }

        // Interface declaration
        lines.push(`public interface ${iface.name} {`);

        // Generate method signatures
        if (iface.methods.length > 0) {
            for (const method of iface.methods) {
                lines.push('');

                // Method JavaDoc
                if (options.includeComments) {
                    lines.push('    /**');
                    lines.push(`     * ${method.name}`);
                    if (method.parameters.length > 0) {
                        for (const param of method.parameters) {
                            lines.push(`     * @param ${param.name}`);
                        }
                    }
                    if (method.returnTypes.length > 0) {
                        lines.push('     * @return result');
                    }
                    lines.push('     */');
                }

                // Method signature
                const returnType = this.getReturnType(method.returnTypes);
                const params = this.generateParameterList(method.parameters);
                const throwsClause = method.returnTypes.some(t => t.name === 'error') ? ' throws Exception' : '';
                lines.push(`    ${returnType} ${GoFunctionParser.toJavaMethodName(method.name)}(${params})${throwsClause};`);
            }
        }

        lines.push('}');

        return lines.join('\n');
    }

    /**
     * Generate a static field from a Go variable or constant
     */
    private static generateStaticField(variable: GoVariable, isFinal: boolean): string {
        const modifiers = isFinal ? 'public static final' : 'public static';
        const javaType = variable.type ? GoFunctionParser.convertGoTypeToJava(variable.type) : 'Object';
        const name = this.toJavaFieldName(variable.name, isFinal);
        const value = variable.value ? ` = ${this.convertValue(variable.value)}` : ' /* TODO: Initialize */';

        return `    ${modifiers} ${javaType} ${name}${isFinal ? value : ' /* TODO: Initialize */'};`;
    }

    /**
     * Generate a class field from a Go struct field
     */
    private static generateClassField(field: GoField, struct: GoStruct, knownTypes: string[]): string {
        const javaType = this.convertTypeToJava(field.type, struct, knownTypes);
        const fieldName = GoFunctionParser.toJavaMethodName(field.name);
        let comment = '';

        if (field.tag) {
            comment = `  // Go tag: ${field.tag}`;
        }

        return `private ${javaType} ${fieldName};${comment}`;
    }

    /**
     * Generate a getter method
     */
    private static generateGetter(field: GoField, struct: GoStruct, knownTypes: string[]): string {
        const javaType = this.convertTypeToJava(field.type, struct, knownTypes);
        const fieldName = GoFunctionParser.toJavaMethodName(field.name);
        const methodName = 'get' + field.name.charAt(0).toUpperCase() + field.name.slice(1);

        return `public ${javaType} ${methodName}() {\n    return ${fieldName};\n}`;
    }

    /**
     * Generate a setter method
     */
    private static generateSetter(field: GoField, struct: GoStruct, knownTypes: string[]): string {
        const javaType = this.convertTypeToJava(field.type, struct, knownTypes);
        const fieldName = GoFunctionParser.toJavaMethodName(field.name);
        const methodName = 'set' + field.name.charAt(0).toUpperCase() + field.name.slice(1);

        return `public void ${methodName}(${javaType} ${fieldName}) {\n    this.${fieldName} = ${fieldName};\n}`;
    }

    /**
     * Convert Go type to Java type with context awareness
     * Uses semantic information from gopls when available
     */
    private static convertTypeToJava(goType: GoType, struct: GoStruct, knownTypes: string[]): string {
        // Check if this is a known custom type
        if (knownTypes.includes(goType.name)) {
            return goType.name;
        }

        // If we have gopls-enriched info, use it for better type mapping
        if (goType.isResolved) {
            // Handle qualified types (e.g., io.Reader)
            if (goType.packagePath && goType.name.includes('.')) {
                // For now, keep the qualified name as-is
                // In a full implementation, we could map common types:
                // - io.Reader -> java.io.InputStream
                // - context.Context -> custom Context interface
                // etc.
            }
        }

        // Use existing type conversion
        return GoFunctionParser.convertGoTypeToJava(goType, goType.isSlice || goType.isMap);
    }

    /**
     * Get Java return type from Go return types
     */
    private static getReturnType(returnTypes: GoType[]): string {
        if (returnTypes.length === 0) {
            return 'void';
        }

        // Filter out error types
        const nonErrorTypes = returnTypes.filter(t => t.name !== 'error');

        if (nonErrorTypes.length === 0) {
            return 'void';
        }

        if (nonErrorTypes.length === 1) {
            return GoFunctionParser.convertGoTypeToJava(nonErrorTypes[0]);
        }

        // Multiple return values would need Result class (handled elsewhere)
        return 'Object';
    }

    /**
     * Generate parameter list for Java method
     */
    private static generateParameterList(parameters: any[]): string {
        return parameters.map(param => {
            const javaType = GoFunctionParser.convertGoTypeToJava(param.type);
            const paramName = GoFunctionParser.toJavaMethodName(param.name);
            return `${javaType} ${paramName}`;
        }).join(', ');
    }

    /**
     * Convert Go field/variable name to Java field name
     */
    private static toJavaFieldName(name: string, isConstant: boolean): string {
        if (isConstant) {
            // Convert to UPPER_SNAKE_CASE
            return name.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
        }
        return GoFunctionParser.toJavaMethodName(name);
    }

    /**
     * Convert Go class name to Java class name
     */
    private static toJavaClassName(name: string): string {
        if (!name) {
            return '';
        }
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    /**
     * Convert Go value to Java value (simple conversion)
     */
    private static convertValue(value: string): string {
        // Simple conversions for common values
        if (value === 'nil') {
            return 'null';
        }
        if (value === 'true' || value === 'false') {
            return value;
        }
        // Return as-is for numbers and strings
        return value;
    }
}
