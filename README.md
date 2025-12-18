# Go to Java Converter

A VS Code extension that helps Java developers learn Go by converting Go code to equivalent Java code with educational hints.

## Features

### Function Conversion
- Convert individual Go function signatures to Java methods
- Multiple output formats:
  - Method only
  - Full class with the method
  - Full class with Result class (for multiple return values)
- **Learning hints** - Get explanations about Go-to-Java conversion decisions

### File Preview (like Markdown Preview)
- Side-by-side preview of entire Go files as Java
- Converts structs to inner classes with fields, constructors, getters/setters
- Converts interfaces to Java interfaces
- Converts package-level variables and constants to static fields
- Auto-refresh on file save

### Hover Tooltips
- See Java equivalents when hovering over Go function signatures
- Configurable output: signature only, method, or full class

### Type Conversions
- Multiple return values (converted to Result classes)
- Error types (converted to exceptions)
- Slices `[]T` to `List<T>`
- Maps `map[K]V` to `Map<K,V>`
- Pointers (handled as Java object references)
- Variadic parameters `...T` to `T...`

## Usage

### Convert a Single Function
1. Open a Go file (`.go`) in VS Code
2. Select a Go function definition or place your cursor on the function line
3. Right-click and choose "Convert Go Function to Java" or press `Ctrl+Shift+J` (`Cmd+Shift+J` on Mac)
4. Choose your preferred output format
5. Choose where to place the generated Java code (clipboard, insert below, or new tab)

### Preview Entire File as Java
1. Open a Go file in VS Code
2. Press `Ctrl+K V` (`Cmd+K V` on Mac) or click the preview icon in the editor title bar
3. A side-by-side Java preview opens, showing the converted file
4. The preview auto-refreshes when you save the Go file

### Hover Preview
1. Hover over any Go function signature
2. See the Java equivalent in a tooltip

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

### Example 2: Slices and Maps

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

### Example 3: Struct Conversion (File Preview)

**Go Code:**
```go
package models

type User struct {
    ID       int    `json:"id"`
    Name     string `json:"name"`
    Email    string `json:"email"`
    IsActive bool   `json:"is_active"`
}

func (u *User) GetDisplayName() string {
    return u.Name
}
```

**Generated Java Code (via File Preview):**
```java
/**
 * Converted from Go package: models
 */
public class Models {

    /**
     * Converted from Go struct: User
     */
    public static class User {
        private int id;      // json:"id"
        private String name; // json:"name"
        private String email; // json:"email"
        private boolean isActive; // json:"is_active"

        public User() {}

        public User(int id, String name, String email, boolean isActive) {
            this.id = id;
            this.name = name;
            this.email = email;
            this.isActive = isActive;
        }

        // Getters and setters...

        /**
         * Converted from Go method with receiver: *User
         */
        public String getDisplayName() {
            // TODO: Implement method logic
            return "";
        }
    }
}
```

## Requirements

- VS Code 1.85.0 or higher
- Go language support extension (recommended)

## Extension Settings

This extension provides the following settings:

### Hover Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `goToJava.hover.enabled` | `true` | Enable hover support to show Java equivalents |
| `goToJava.hover.output` | `"signature"` | What to show in hover: `"signature"`, `"method"`, or `"class"` |
| `goToJava.hover.maxScanLines` | `20` | Maximum lines to scan for multiline function definitions |

### Preview Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `goToJava.preview.refreshOnSave` | `true` | Auto-refresh Java preview when Go file is saved |
| `goToJava.preview.includeGettersSetters` | `true` | Generate getters/setters for struct fields |

### Parser Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `goToJava.parser` | `"tree-sitter"` | Parser engine: `"regex"` or `"tree-sitter"` (recommended for accuracy) |

## Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| `Go to Java: Convert Go Function to Java` | `Ctrl+Shift+J` / `Cmd+Shift+J` | Convert selected function to Java |
| `Go to Java: Preview File as Java` | `Ctrl+K V` / `Cmd+K V` | Open side-by-side Java preview |
| `Go to Java: Refresh Java Preview` | - | Manually refresh the preview |

## Go vs Java Quick Reference

For Java developers learning Go:

| Go Concept | Java Equivalent | Notes |
|------------|----------------|-------|
| Multiple return values `(int, error)` | Result classes or exceptions | Go commonly returns `(value, error)` |
| `error` type | `Exception` / `throws` | Go uses explicit error returns, not exceptions |
| `[]T` (slice) | `List<T>` | Go slices are dynamic arrays |
| `map[K]V` | `Map<K,V>` | Similar key-value stores |
| `...T` (variadic) | `T...` (varargs) | Variable number of arguments |
| `*T` (pointer) | `T` (reference) | All Java objects are references by default |
| `nil` | `null` | Represents absence of value |
| `struct` | `class` | Go structs become Java classes |
| `interface` | `interface` | Similar concept, Go uses implicit implementation |
| `:=` short declaration | Type inference `var` | Go infers type from value |
| Package functions | `static` methods | Go package-level functions become static methods |

## Limitations

The extension currently does not convert:

- Function bodies / implementation logic (generates stubs with TODO comments)
- Goroutines and channels (concurrency primitives)
- `defer` statements
- `panic`/`recover` (Go's error recovery mechanism)
- Go generics with type parameters `[T any]`
- Go modules and package imports (only package name is used)

## Release Notes

### 0.0.5
- Added tree-sitter parsing option for improved accuracy
- Tree-sitter is now the default parser

### 0.0.4
- Added Java file preview feature (like markdown preview)
- Full Go file parsing: structs, interfaces, package-level variables/constants
- Methods are attached to their receiver structs
- Auto-refresh preview on file save

### 0.0.3
- Added hover support for inline Java previews
- Configurable hover output modes

### 0.0.2
- Added multiline function signature support
- Fixed type conversion bugs (uint8, boxing for generics)
- Added learning hints to explain Go-to-Java conversions
- Support for variadic parameters (`...T`)
- Fixed "Method + Result class" to generate valid Java

### 0.0.1
- Initial release with basic Go to Java conversion functionality

## Contributing

Found a bug or have a suggestion? Please open an issue on GitHub!

## For Java Developers Learning Go

This extension is designed to help you understand Go by showing equivalent Java code. Remember:

1. **Go is simpler** - No classes, inheritance, or complex type hierarchies
2. **Error handling is explicit** - Check errors, don't catch exceptions
3. **Concurrency is built-in** - Goroutines and channels (not converted by this extension)
4. **Composition over inheritance** - Use interfaces and embedding
5. **Implicit interface implementation** - No `implements` keyword needed

## License

MIT
