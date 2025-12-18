import * as Parser from 'web-tree-sitter';
import {
    GoFile,
    GoImport,
    GoStruct,
    GoField,
    GoInterface,
    GoMethodSignature,
    GoVariable
} from './goFileParser';
import { GoType, GoFunction, GoParameter } from './goParser';

type SyntaxNode = any;
type TSParser = any;

let parserInit: Promise<TSParser>;

async function getParser(): Promise<TSParser> {
    if (!parserInit) {
        parserInit = (async () => {
            const ParserModule: any = Parser;
            await ParserModule.Parser.init();
            const parser = new ParserModule.Parser();
            const goWasm = require.resolve('tree-sitter-go/tree-sitter-go.wasm');
            const GoLang = await ParserModule.Language.load(goWasm);
            parser.setLanguage(GoLang);
            return parser;
        })();
    }
    return parserInit;
}

function textOf(node: SyntaxNode, source: string): string {
    return source.slice(node.startIndex, node.endIndex);
}

function parseTypeNode(node: SyntaxNode, source: string): GoType {
    if (!node) {
        return { name: 'interface{}', isPointer: false, isSlice: false, isMap: false, isVariadic: false };
    }
    switch (node.type) {
        case 'pointer_type':
            const pointee = node.childForFieldName('type') || node.child(1);
            return { ...parseTypeNode(pointee, source), isPointer: true };
        case 'slice_type':
            return { ...parseTypeNode(node.childForFieldName('element')!, source), isSlice: true };
        case 'map_type': {
            const key = parseTypeNode(node.childForFieldName('key')!, source);
            const value = parseTypeNode(node.childForFieldName('value')!, source);
            return {
                name: 'Map',
                isPointer: false,
                isSlice: false,
                isMap: true,
                isVariadic: false,
                keyType: key,
                valueType: value
            };
        }
        case 'variadic_parameter':
            return { ...parseTypeNode(node.childForFieldName('type')!, source), isVariadic: true, isSlice: true };
        case 'qualified_type':
        case 'type_identifier':
        case 'package_identifier':
        default:
            return {
                name: textOf(node, source),
                isPointer: false,
                isSlice: false,
                isMap: false,
                isVariadic: false
            };
    }
}

function parseParameters(node: SyntaxNode | null | undefined, source: string): GoParameter[] {
    if (!node) return [];
    const params: GoParameter[] = [];
    node.namedChildren
        .filter((child: SyntaxNode) => child.type === 'parameter_declaration' || child.type === 'variadic_parameter' || child.type === 'variadic_parameter_declaration')
        .forEach((paramNode: SyntaxNode) => {
            const names = paramNode
                .children
                .filter((c: SyntaxNode) => c.type === 'identifier')
                .map((c: SyntaxNode) => textOf(c, source));

            const typeNode = paramNode.childForFieldName('type') || paramNode;
            const goType = {
                ...parseTypeNode(typeNode, source),
                isVariadic: paramNode.type === 'variadic_parameter_declaration' ? true : parseTypeNode(typeNode, source).isVariadic
            };
            if (names.length === 0) {
                params.push({ name: '', type: goType });
            } else {
                names.forEach((name: string) => params.push({ name, type: goType }));
            }
        });
    return params;
}

function parseResultTypes(resultNode: SyntaxNode | null | undefined, source: string): GoType[] {
    if (!resultNode) return [];
    if (resultNode.type === 'parameter_list') {
        return parseParameters(resultNode, source).map((p) => p.type);
    }
    return [parseTypeNode(resultNode, source)];
}

function buildFunction(fnNode: SyntaxNode, source: string, isMethod: boolean): GoFunction | null {
    const nameNode = fnNode.childForFieldName('name');
    if (!nameNode) return null;
    const name = textOf(nameNode, source);
    const params = parseParameters(fnNode.childForFieldName('parameters'), source);
    const returnTypes = parseResultTypes(fnNode.childForFieldName('result'), source);

    let receiver: GoParameter | undefined;
    if (isMethod) {
        const recvList = fnNode.childForFieldName('receiver');
        const recvParams = parseParameters(recvList, source);
        receiver = recvParams[0];
    }

    return {
        name,
        parameters: params,
        returnTypes,
        isMethod,
        receiver,
        hasErrorReturn: returnTypes.some((t) => t.name === 'error')
    };
}

function parseFieldDeclaration(node: SyntaxNode, source: string): GoField | null {
    const typeNode = node.childForFieldName('type');
    const names = node.children.filter((c: SyntaxNode) => c.type === 'field_identifier').map((c: SyntaxNode) => textOf(c, source));
    if (!typeNode || names.length === 0) return null;
    const tagNode = node.childForFieldName('tag');
    const goType = parseTypeNode(typeNode, source);
    return {
        name: names[0],
        type: goType,
        tag: tagNode ? textOf(tagNode, source).replace(/`/g, '') : undefined,
        exported: /^[A-Z]/.test(names[0])
    };
}

function parseStruct(typeName: string, node: SyntaxNode, source: string): GoStruct {
    const fields: GoField[] = [];
    const fieldNodes = typeof node.descendantsOfType === 'function'
        ? node.descendantsOfType('field_declaration')
        : [];
    fieldNodes.forEach((f: SyntaxNode) => {
        const field = parseFieldDeclaration(f, source);
        if (field) fields.push(field);
    });
    return { name: typeName, fields, methods: [] };
}

function parseInterface(typeName: string, node: SyntaxNode, source: string): GoInterface {
    const methods: GoMethodSignature[] = [];
    const methodNodes = typeof node.descendantsOfType === 'function'
        ? node.descendantsOfType(['method_spec', 'method_elem'])
        : [];
    methodNodes.forEach((m: SyntaxNode) => {
        const nameNode = m.childForFieldName('name') || m.namedChildren.find((n: SyntaxNode) => n.type === 'field_identifier');
        if (!nameNode) return;
        const params = parseParameters(m.childForFieldName('parameters'), source);
        const returns = parseResultTypes(m.childForFieldName('result'), source);
        methods.push({ name: textOf(nameNode, source), parameters: params, returnTypes: returns });
    });
    return { name: typeName, methods };
}

function parseImports(node: SyntaxNode, source: string): GoImport[] {
    const imports: GoImport[] = [];
    node.namedChildren
        .filter((child: SyntaxNode) => child.type === 'import_spec')
        .forEach((spec: SyntaxNode) => {
            const pathNode = spec.childForFieldName('path');
            if (!pathNode) return;
            const aliasNode = spec.childForFieldName('name');
            imports.push({
                alias: aliasNode ? textOf(aliasNode, source) : undefined,
                path: textOf(pathNode, source).replace(/"/g, '')
            });
        });
    return imports;
}

function inferTypeFromValue(value: string): GoType | undefined {
    if (/^".*"$/.test(value)) {
        return { name: 'string', isPointer: false, isSlice: false, isMap: false, isVariadic: false };
    }
    if (/^(true|false)$/.test(value)) {
        return { name: 'bool', isPointer: false, isSlice: false, isMap: false, isVariadic: false };
    }
    if (/^\d+$/.test(value)) {
        return { name: 'int', isPointer: false, isSlice: false, isMap: false, isVariadic: false };
    }
    if (/^\d+\.\d+$/.test(value)) {
        return { name: 'float64', isPointer: false, isSlice: false, isMap: false, isVariadic: false };
    }
    return undefined;
}

function parseVars(node: SyntaxNode, source: string, isConst: boolean): GoVariable[] {
    const vars: GoVariable[] = [];
    node.namedChildren
        .filter((child: SyntaxNode) => child.type === (isConst ? 'const_spec' : 'var_spec'))
        .forEach((spec: SyntaxNode) => {
            const names = spec.namedChildren.filter((c: SyntaxNode) => c.type === 'identifier');
            const typeNode = spec.childForFieldName('type');
            const valueNode = spec.childForFieldName('value');

            names.forEach((n: SyntaxNode) => {
                const name = textOf(n, source);
                const exported = /^[A-Z]/.test(name);
                const value = valueNode ? textOf(valueNode, source) : undefined;
                const type = typeNode
                    ? parseTypeNode(typeNode, source)
                    : value ? inferTypeFromValue(value) : undefined;
                vars.push({ name, type, isConst, exported, value });
            });
        });
    return vars;
}

function inferPackage(tree: Parser.Tree, source: string): string {
    const pkgNode = tree.rootNode.descendantsOfType('package_clause')[0];
    const nameNode = pkgNode?.childForFieldName('name');
    return nameNode ? textOf(nameNode, source) : '';
}

export async function parseFunction(text: string): Promise<GoFunction | null> {
    const parser = await getParser();
    const tree = parser.parse(text);
    const funcNode =
        tree.rootNode.descendantsOfType('function_declaration')[0] ||
        tree.rootNode.descendantsOfType('method_declaration')[0];
    if (!funcNode) return null;
    const isMethod = funcNode.type === 'method_declaration';
    return buildFunction(funcNode, text, isMethod);
}

export async function parseFile(content: string): Promise<GoFile> {
    const parser = await getParser();
    const tree = parser.parse(content);
    const root = tree.rootNode;

    const goFile: GoFile = {
        packageName: inferPackage(tree, content),
        imports: [],
        structs: [],
        interfaces: [],
        functions: [],
        variables: [],
        constants: []
    };

    root.children.forEach((child: SyntaxNode) => {
        switch (child.type) {
            case 'import_declaration':
                goFile.imports.push(...parseImports(child, content));
                break;
            case 'function_declaration': {
                const fn = buildFunction(child, content, false);
                if (fn) goFile.functions.push(fn);
                break;
            }
            case 'method_declaration': {
                const fn = buildFunction(child, content, true);
                if (fn) goFile.functions.push(fn);
                break;
            }
            case 'type_declaration':
                child.namedChildren
                    .filter((c: SyntaxNode) => c.type === 'type_spec')
                    .forEach((spec: SyntaxNode) => {
                        const nameNode = spec.childForFieldName('name');
                        const typeNode = spec.childForFieldName('type');
                        if (!nameNode || !typeNode) return;
                        const typeName = textOf(nameNode, content);
                        if (typeNode.type === 'struct_type') {
                            goFile.structs.push(parseStruct(typeName, typeNode, content));
                        } else if (typeNode.type === 'interface_type') {
                            goFile.interfaces.push(parseInterface(typeName, typeNode, content));
                        }
                    });
                break;
            case 'const_declaration':
                goFile.constants.push(...parseVars(child, content, true));
                break;
            case 'var_declaration':
                goFile.variables.push(...parseVars(child, content, false));
                break;
        }
    });

    // Attach methods to structs by receiver type name (best-effort)
    goFile.functions = goFile.functions.filter((fn) => {
        if (fn.isMethod && fn.receiver) {
            const receiverType = fn.receiver.type.name.replace(/^\*/, '');
            const struct = goFile.structs.find((s) => s.name === receiverType);
            if (struct) {
                struct.methods.push(fn);
                return false;
            }
        }
        return true;
    });

    return goFile;
}
