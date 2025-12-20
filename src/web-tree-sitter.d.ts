declare module 'web-tree-sitter' {
    export interface Point {
        row: number;
        column: number;
    }

    export interface SyntaxNode {
        type: string;
        text: string;
        startPosition: Point;
        endPosition: Point;
        startIndex: number;
        endIndex: number;
        parent: SyntaxNode | null;
        children: SyntaxNode[];
        namedChildren: SyntaxNode[];
        childCount: number;
        namedChildCount: number;
        firstChild: SyntaxNode | null;
        firstNamedChild: SyntaxNode | null;
        lastChild: SyntaxNode | null;
        lastNamedChild: SyntaxNode | null;
        nextSibling: SyntaxNode | null;
        nextNamedSibling: SyntaxNode | null;
        previousSibling: SyntaxNode | null;
        previousNamedSibling: SyntaxNode | null;
        childForFieldName(name: string): SyntaxNode | null;
        childrenForFieldName(name: string): SyntaxNode[];
        descendantsOfType(type: string | string[]): SyntaxNode[];
    }

    export interface Tree {
        rootNode: SyntaxNode;
    }

    export interface Language {}

    export default class Parser {
        static init(): Promise<void>;
        static Language: {
            load(path: string): Promise<Language>;
        };
        setLanguage(language: Language): void;
        parse(input: string): Tree;
    }
}
