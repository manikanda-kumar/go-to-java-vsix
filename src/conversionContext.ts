import { GoFile, GoStruct, GoInterface, buildImportAliasMap } from './goFileParser';
import { TypeDependencyGraph } from './typeDependencyResolver';

/**
 * Context for Go-to-Java conversion with resolved type dependencies.
 * This provides all the information needed for accurate conversion,
 * including external types from other packages.
 */
export interface ConversionContext {
    /** The main Go file being converted */
    mainFile: GoFile;
    
    /** External structs resolved from dependencies */
    externalStructs: GoStruct[];
    
    /** External interfaces resolved from dependencies */
    externalInterfaces: GoInterface[];
    
    /** Map of import alias to full import path (e.g., "http" -> "net/http") */
    importAliasMap: Map<string, string>;
    
    /** Map of fully-qualified Go type to Java type (for stdlib mapping) */
    stdlibTypeMap: Map<string, StdlibTypeMapping>;
    
    /** Whether deep LSP resolution was successful */
    lspResolutionSucceeded: boolean;
}

/**
 * Mapping for a Go stdlib type to its Java equivalent
 */
export interface StdlibTypeMapping {
    /** The Java type name (e.g., "InputStream") */
    javaType: string;
    
    /** Java import needed (e.g., "java.io.InputStream") */
    javaImport?: string;
    
    /** Whether this is a Java interface */
    isInterface?: boolean;
    
    /** Educational note about the conversion */
    conversionNote?: string;
}

/**
 * Mapping of common Go stdlib types to Java equivalents.
 * This helps generate more idiomatic Java code.
 */
export const STDLIB_TYPE_MAPPINGS: Map<string, StdlibTypeMapping> = new Map([
    // io package
    ['io.Reader', {
        javaType: 'InputStream',
        javaImport: 'java.io.InputStream',
        isInterface: true,
        conversionNote: 'Go io.Reader maps to Java InputStream for byte reading'
    }],
    ['io.Writer', {
        javaType: 'OutputStream',
        javaImport: 'java.io.OutputStream',
        isInterface: true,
        conversionNote: 'Go io.Writer maps to Java OutputStream for byte writing'
    }],
    ['io.Closer', {
        javaType: 'Closeable',
        javaImport: 'java.io.Closeable',
        isInterface: true,
        conversionNote: 'Go io.Closer maps to Java Closeable interface'
    }],
    ['io.ReadWriter', {
        javaType: 'Object', // No direct equivalent
        conversionNote: 'Go io.ReadWriter has no direct Java equivalent - consider separate streams'
    }],
    ['io.ReadCloser', {
        javaType: 'InputStream',
        javaImport: 'java.io.InputStream',
        isInterface: true,
        conversionNote: 'Go io.ReadCloser maps to InputStream (which is Closeable)'
    }],
    ['io.WriteCloser', {
        javaType: 'OutputStream',
        javaImport: 'java.io.OutputStream',
        isInterface: true,
        conversionNote: 'Go io.WriteCloser maps to OutputStream (which is Closeable)'
    }],
    
    // context package
    ['context.Context', {
        javaType: 'Object', // Or custom Context interface
        conversionNote: 'Go context.Context has no direct Java equivalent - consider custom Context class or thread-local storage'
    }],
    
    // time package
    ['time.Time', {
        javaType: 'Instant',
        javaImport: 'java.time.Instant',
        conversionNote: 'Go time.Time maps to Java Instant for point-in-time representation'
    }],
    ['time.Duration', {
        javaType: 'Duration',
        javaImport: 'java.time.Duration',
        conversionNote: 'Go time.Duration maps to Java Duration'
    }],
    
    // net/http package
    ['http.Request', {
        javaType: 'HttpServletRequest',
        javaImport: 'javax.servlet.http.HttpServletRequest',
        isInterface: true,
        conversionNote: 'Go http.Request maps to HttpServletRequest in servlet-based apps'
    }],
    ['http.ResponseWriter', {
        javaType: 'HttpServletResponse',
        javaImport: 'javax.servlet.http.HttpServletResponse',
        isInterface: true,
        conversionNote: 'Go http.ResponseWriter maps to HttpServletResponse in servlet-based apps'
    }],
    ['http.Handler', {
        javaType: 'Object', // Or custom handler interface
        isInterface: true,
        conversionNote: 'Go http.Handler can be implemented as a functional interface or servlet'
    }],
    ['http.Client', {
        javaType: 'HttpClient',
        javaImport: 'java.net.http.HttpClient',
        conversionNote: 'Go http.Client maps to Java 11+ HttpClient'
    }],
    
    // sync package
    ['sync.Mutex', {
        javaType: 'ReentrantLock',
        javaImport: 'java.util.concurrent.locks.ReentrantLock',
        conversionNote: 'Go sync.Mutex maps to Java ReentrantLock'
    }],
    ['sync.RWMutex', {
        javaType: 'ReentrantReadWriteLock',
        javaImport: 'java.util.concurrent.locks.ReentrantReadWriteLock',
        conversionNote: 'Go sync.RWMutex maps to Java ReentrantReadWriteLock'
    }],
    ['sync.WaitGroup', {
        javaType: 'CountDownLatch',
        javaImport: 'java.util.concurrent.CountDownLatch',
        conversionNote: 'Go sync.WaitGroup maps to Java CountDownLatch (note: different usage pattern)'
    }],
    ['sync.Once', {
        javaType: 'Object', // Use lazy initialization pattern
        conversionNote: 'Go sync.Once can be implemented with double-checked locking or AtomicReference'
    }],
    ['sync.Map', {
        javaType: 'ConcurrentHashMap',
        javaImport: 'java.util.concurrent.ConcurrentHashMap',
        conversionNote: 'Go sync.Map maps to Java ConcurrentHashMap'
    }],
    
    // bytes package
    ['bytes.Buffer', {
        javaType: 'ByteArrayOutputStream',
        javaImport: 'java.io.ByteArrayOutputStream',
        conversionNote: 'Go bytes.Buffer maps to ByteArrayOutputStream for writing, ByteArrayInputStream for reading'
    }],
    ['bytes.Reader', {
        javaType: 'ByteArrayInputStream',
        javaImport: 'java.io.ByteArrayInputStream',
        conversionNote: 'Go bytes.Reader maps to Java ByteArrayInputStream'
    }],
    
    // strings package
    ['strings.Builder', {
        javaType: 'StringBuilder',
        javaImport: undefined, // In java.lang
        conversionNote: 'Go strings.Builder maps directly to Java StringBuilder'
    }],
    ['strings.Reader', {
        javaType: 'StringReader',
        javaImport: 'java.io.StringReader',
        conversionNote: 'Go strings.Reader maps to Java StringReader'
    }],
    
    // bufio package
    ['bufio.Reader', {
        javaType: 'BufferedReader',
        javaImport: 'java.io.BufferedReader',
        conversionNote: 'Go bufio.Reader maps to Java BufferedReader'
    }],
    ['bufio.Writer', {
        javaType: 'BufferedWriter',
        javaImport: 'java.io.BufferedWriter',
        conversionNote: 'Go bufio.Writer maps to Java BufferedWriter'
    }],
    ['bufio.Scanner', {
        javaType: 'Scanner',
        javaImport: 'java.util.Scanner',
        conversionNote: 'Go bufio.Scanner maps to Java Scanner'
    }],
    
    // os package
    ['os.File', {
        javaType: 'RandomAccessFile',
        javaImport: 'java.io.RandomAccessFile',
        conversionNote: 'Go os.File maps to RandomAccessFile for read/write, or FileInputStream/FileOutputStream'
    }],
    
    // regexp package
    ['regexp.Regexp', {
        javaType: 'Pattern',
        javaImport: 'java.util.regex.Pattern',
        conversionNote: 'Go regexp.Regexp maps to Java Pattern (note: different regex syntax)'
    }],
    
    // encoding/json package
    ['json.Decoder', {
        javaType: 'ObjectMapper',
        javaImport: 'com.fasterxml.jackson.databind.ObjectMapper',
        conversionNote: 'Go json.Decoder typically maps to Jackson ObjectMapper in Java'
    }],
    ['json.Encoder', {
        javaType: 'ObjectMapper',
        javaImport: 'com.fasterxml.jackson.databind.ObjectMapper',
        conversionNote: 'Go json.Encoder typically maps to Jackson ObjectMapper in Java'
    }],
    
    // errors package
    ['errors.error', {
        javaType: 'Exception',
        conversionNote: 'Go error interface maps to Java Exception hierarchy'
    }],
    
    // fmt package types (rare as types, but included)
    ['fmt.Stringer', {
        javaType: 'Object', // toString() method
        isInterface: true,
        conversionNote: 'Go fmt.Stringer is equivalent to overriding toString() in Java'
    }],
]);

/**
 * Create a ConversionContext from a GoFile and optional dependency graph.
 */
export function createConversionContext(
    goFile: GoFile,
    dependencyGraph?: TypeDependencyGraph
): ConversionContext {
    return {
        mainFile: goFile,
        externalStructs: dependencyGraph?.externalStructs || [],
        externalInterfaces: dependencyGraph?.externalInterfaces || [],
        importAliasMap: buildImportAliasMap(goFile),
        stdlibTypeMap: STDLIB_TYPE_MAPPINGS,
        lspResolutionSucceeded: !!dependencyGraph
    };
}

/**
 * Look up a Go type in the stdlib mapping.
 * Handles both "package.Type" and "Type" (when packagePath is provided separately).
 */
export function lookupStdlibType(
    typeName: string,
    packagePath?: string
): StdlibTypeMapping | undefined {
    // Try full qualified name first
    if (typeName.includes('.')) {
        return STDLIB_TYPE_MAPPINGS.get(typeName);
    }
    
    // Try with provided package path
    if (packagePath) {
        const qualifiedName = `${packagePath}.${typeName}`;
        return STDLIB_TYPE_MAPPINGS.get(qualifiedName);
    }
    
    return undefined;
}

/**
 * Get all Java imports needed for the stdlib types used in a conversion.
 */
export function getRequiredJavaImports(context: ConversionContext): string[] {
    const imports = new Set<string>();
    
    // Always add common imports
    imports.add('java.util.*');
    
    // Add imports for stdlib mappings used
    // This would need to track which types are actually used during conversion
    // For now, we just return the base imports
    
    return Array.from(imports);
}
