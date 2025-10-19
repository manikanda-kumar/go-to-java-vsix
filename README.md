# Go to Java Converter

A VS Code extension that helps Java developers learn Go by converting Go function definitions to equivalent Java code with educational hints.

## Features

- Convert Go function definitions to Java equivalents
- Multiple output formats:
  - Method only
  - Full class with the method
  - Full class with Result class (for multiple return values)
- **Learning hints** - Get explanations about Go→Java conversion decisions
- Context menu integration for Go files
- Keyboard shortcut (Ctrl+Shift+J / Cmd+Shift+J)
- Smart error handling and type conversion
- Support for:
  - Multiple return values (converted to Result classes)
  - Error types (converted to exceptions)
  - Slices and maps (converted to List/Map)
  - Pointers (handled as Java object references)
  - Variadic parameters (...T → T...)

## Usage

1. Open a Go file (`.go`) in VS Code
2. Select a Go function definition or place your cursor on the function line
3. Right-click and choose "Convert Go Function to Java" or use the keyboard shortcut
4. Choose your preferred output format
5. Choose where to place the generated Java code (clipboard, insert below, or new tab)

## Examples

### Example 1: Simple Function with Error Handling

**Go Code:**
```go
func add(a int, b int) (int, error) {
    if a < 0 || b < 0 {
        return 0, errors.New("negative numbers not allowed")
    }
    return a + b, nil
}
```

**Generated Java Code:**
```java
/**
 * Go to Java Conversion Notes:
 * - Go's error type is mapped to Java exceptions (throws Exception)
 */
public class GoConverter {

    /**
     * Converted from Go function: add
     *
     * @param a int value
     * @param b int value
     *
     * @return int value
     * @throws Exception if operation fails
     */
    public static int add(int a, int b) throws Exception {
        // TODO: Implement method logic
        return 0;
    }
}
```

### Example 2: Multiple Return Values

**Go Code:**
```go
func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}
```

**Generated Java Code with Result Class:**
```java
/**
 * Go to Java Conversion Notes:
 * - Go's error type is mapped to Java exceptions (throws Exception)
 */
public class GoConverter {

    /**
     * Converted from Go function: divide
     *
     * @param a double value
     * @param b double value
     *
     * @return double value
     * @throws Exception if operation fails
     */
    public static double divide(double a, double b) throws Exception {
        // TODO: Implement method logic
        return 0.0;
    }
}
```

### Example 3: Slices and Maps

**Go Code:**
```go
func processData(nums []int, metadata map[string]int) int {
    return len(nums) + len(metadata)
}
```

**Generated Java Code:**
```java
/**
 * Go to Java Conversion Notes:
 * - Go slices are mapped to Java List<T> (dynamic arrays)
 * - Go maps are mapped to Java Map<K,V>
 */
public class GoConverter {

    /**
     * Converted from Go function: processData
     *
     * @param nums list of int values
     * @param metadata map with String keys and Integer values
     *
     * @return int value
     */
    public static int processData(List<Integer> nums, Map<String, Integer> metadata) {
        // TODO: Implement method logic
        return 0;
    }
}
```

### Example 4: Variadic Parameters

**Go Code:**
```go
func sum(numbers ...int) int {
    total := 0
    for _, num := range numbers {
        total += num
    }
    return total
}
```

**Generated Java Code:**
```java
/**
 * Go to Java Conversion Notes:
 * - Go variadic parameters (...T) are mapped to Java varargs (T...)
 */
public class GoConverter {

    /**
     * Converted from Go function: sum
     *
     * @param numbers list of int values
     *
     * @return int value
     */
    public static int sum(int... numbers) {
        // TODO: Implement method logic
        return 0;
    }
}
```

## Requirements

- VS Code 1.85.0 or higher
- Go language support extension (recommended)

## Go vs Java Quick Reference

For Java developers learning Go, here are key differences:

| Go Concept | Java Equivalent | Notes |
|------------|----------------|-------|
| Multiple return values `(int, error)` | Result classes or exceptions | Go commonly returns `(value, error)` |
| `error` type | `Exception` / `throws` | Go uses explicit error returns, not exceptions |
| `[]T` (slice) | `List<T>` | Go slices are dynamic arrays |
| `map[K]V` | `Map<K,V>` | Similar key-value stores |
| `...T` (variadic) | `T...` (varargs) | Variable number of arguments |
| `*T` (pointer) | `T` (reference) | All Java objects are references by default |
| `nil` | `null` | Represents absence of value |
| No classes | Classes required | Go uses functions and structs; Java requires classes |
| `:=` short declaration | Type inference `var` | Go infers type from value |

## Limitations

This extension currently focuses on **function signatures only** and does not convert:

- Function bodies / implementation logic
- Go structs to Java classes
- Go interfaces to Java interfaces
- Goroutines and channels (concurrency primitives)
- `defer` statements
- `panic`/`recover` (Go's error recovery mechanism)
- Go generics with type parameters `[T any]`
- Package-level variables and constants
- Go modules and package imports

The generated Java code includes `TODO` comments where you need to implement the actual logic.

## Extension Settings

This extension contributes no settings in this initial version.

## Release Notes

### 0.0.2

- Added multiline function signature support
- Fixed type conversion bugs (uint8, boxing for generics)
- Added learning hints to explain Go→Java conversions
- Support for variadic parameters (`...T`)
- Fixed "Method + Result class" to generate valid Java
- Improved README with multiple examples

### 0.0.1

Initial release with basic Go to Java conversion functionality.

## Contributing

Found a bug or have a suggestion? Please open an issue on GitHub!

## For Java Developers Learning Go

This extension is designed to help you understand Go by showing equivalent Java code. Remember:

1. **Go is simpler** - No classes, inheritance, or complex type hierarchies
2. **Error handling is explicit** - Check errors, don't catch exceptions
3. **Concurrency is built-in** - Goroutines and channels (not yet supported by this extension)
4. **Composition over inheritance** - Use interfaces and embedding

## License

MIT