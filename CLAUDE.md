# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A VS Code extension that helps Java developers learn Go by converting Go code to equivalent Java code with educational hints. The extension provides:
- **Function conversion**: Convert individual Go function signatures to Java methods
- **File preview**: Side-by-side preview of entire Go files as Java (like markdown preview)
- **Hover tooltips**: See Java equivalents when hovering over Go functions

## Development Commands

### Build and Development
```bash
# Compile TypeScript (watch mode)
npm run compile

# The compiled output goes to ./out directory
# Main entry point: ./out/extension.js
```

### Testing the Extension
- Press F5 in VS Code to launch Extension Development Host
- Open a .go file in the development host
- Use Ctrl+Shift+J (Cmd+Shift+J on Mac) or right-click context menu to convert Go functions

### Packaging
```bash
# Package the extension
npx vsce package
```

## Architecture

### Core Components

**src/extension.ts** - Extension activation and command registration
- Registers the `goToJava.convertFunction` command
- Registers the hover provider for inline Java previews
- Handles user interaction flow: parse → generate → output (clipboard/insert/new tab)
- Provides three output formats: Method only, Full class, Full class with Result

**src/goParser.ts** - Go function signature parser
- `GoFunctionParser.parseFunction()`: Main entry point for parsing Go function text
- Handles multi-line function signatures (scans until finding `{`)
- Parses receivers for Go methods
- Parses parameters with Go's grouped syntax (e.g., `a, b int`)
- Parses return types including multiple return values
- `parseType()`: Handles pointers, slices, maps, and variadic parameters
- Type mapping: Go primitives → Java primitives (int→int, string→String, etc.)
- Boxing logic: Uses wrapper types (Integer, Boolean, etc.) when needed for generics

**src/javaGenerator.ts** - Java code generator
- `generateJavaMethod()`: Creates Java method with signature and stub body
- `generateFullJavaClass()`: Wraps method in a complete class with imports
- `generateResultClass()`: Creates nested Result class for multiple return values
- Generates JavaDoc comments with parameter descriptions and conversion notes
- Learning hints: Adds educational comments about Go→Java conversions
- Default value generation for return types

**src/hoverProvider.ts** - Hover tooltip provider
- Shows Java equivalent when hovering over Go function signatures
- Configurable output modes: signature only, method, or full class
- Scans up to `maxScanLines` to find function header (handles multiline signatures)
- Respects user settings: `goToJava.hover.enabled`, `goToJava.hover.output`, `goToJava.hover.maxScanLines`

**src/goFileParser.ts** - Full Go file parser
- `GoFileParser.parseFile()`: Main entry point for parsing entire Go files
- Parses package declarations and imports
- Parses struct definitions with fields and struct tags
- Parses interface definitions with method signatures
- Parses package-level variables and constants
- Attaches methods to their receiver structs
- Reuses `GoFunctionParser` for function signature parsing

**src/javaFileGenerator.ts** - Full Java file generator
- `JavaFileGenerator.generateJavaFile()`: Converts parsed Go file to complete Java class
- Generates inner classes from Go structs (with fields, constructors, getters/setters)
- Generates inner interfaces from Go interfaces
- Generates static fields from package variables/constants
- Generates static methods from package-level functions
- Adds educational comments explaining Go→Java conversions

**src/previewProvider.ts** - VS Code preview content provider
- Implements `TextDocumentContentProvider` for virtual documents
- Uses `java-preview:` URI scheme
- Reads Go files, parses, and generates Java for preview
- Supports refresh via `onDidChange` event
- Auto-refreshes on file save (configurable)

### Data Flow

**Function Conversion (single function):**
1. User invokes command or hovers over Go function
2. `GoFunctionParser` extracts and parses the function signature into `GoFunction` object
3. `JavaCodeGenerator` converts `GoFunction` to Java code with specified options
4. Output is displayed via clipboard, editor insertion, or new tab (command) / hover tooltip (hover provider)

**File Preview (entire file):**
1. User invokes "Preview File as Java" command (Ctrl+K V)
2. `JavaPreviewProvider` receives request with preview URI
3. `GoFileParser` parses entire Go file into `GoFile` object (structs, interfaces, functions, variables)
4. `JavaFileGenerator` converts `GoFile` to complete Java class
5. Java preview opens in side-by-side editor panel
6. On file save, preview automatically refreshes (if configured)

### Key Type Conversions

- Go slices `[]T` → Java `List<BoxedT>` (always uses boxed types for generics)
- Go maps `map[K]V` → Java `Map<BoxedK, BoxedV>`
- Go error type → Java `throws Exception`
- Go variadic `...T` → Java varargs `T...`
- Go pointers `*T` → Java references (boxed for primitives)
- Multiple return values → Result class with getters/setters

### Configuration

Extension settings in package.json:

**Hover settings:**
- `goToJava.hover.enabled`: Enable/disable hover tooltips (default: true)
- `goToJava.hover.output`: What to show in hover ("signature", "method", "class")
- `goToJava.hover.maxScanLines`: How many lines to scan for function definition (default: 20)

**Preview settings:**
- `goToJava.preview.refreshOnSave`: Auto-refresh preview when Go file is saved (default: true)
- `goToJava.preview.includeGettersSetters`: Generate getters/setters for struct fields (default: true)

## Important Implementation Details

### Multiline Function Handling
The extension scans forward from the `func` keyword until finding `{` to handle Go functions split across multiple lines. Both the command handler (extension.ts) and hover provider use similar scanning logic.

### Parameter Grouping
Go allows grouped parameters like `func add(a, b int)`. The parser handles this by tracking which segments have types and grouping names that share a type.

### Error Handling as Exceptions
When a Go function returns an error type, it's converted to Java's `throws Exception` pattern. The error return is filtered out from the actual return type.

### Learning Hints Mode
When `addLearningHints` is enabled, the generator adds comments explaining conversion decisions (slices→List, errors→exceptions, etc.) to help Java developers understand Go concepts.

## Extension Points

- **Activation**: Only activates when a Go file is opened (`activationEvents: onLanguage:go`)
- **Commands**: Registered in `package.json` under `contributes.commands`
  - `goToJava.convertFunction`: Convert selected Go function to Java
  - `goToJava.previewFile`: Open side-by-side Java preview of entire file
  - `goToJava.refreshPreview`: Manually refresh the Java preview
- **Menus**: Context menu appears only in Go files (`when: editorLangId == go`)
- **Keybindings**:
  - Ctrl+Shift+J / Cmd+Shift+J: Convert function
  - Ctrl+K V / Cmd+K V: Preview file as Java (like markdown preview)
