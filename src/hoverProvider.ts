import * as vscode from 'vscode';
import { GoFunctionParser } from './goParser';
import { JavaCodeGenerator } from './javaGenerator';
import { findFunctionHeader } from './functionLocator';
import * as TreeSitterGoParser from './treeSitterGoParser';

export class GoToJavaHoverProvider implements vscode.HoverProvider {
    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const config = vscode.workspace.getConfiguration('goToJava');
        const enabled = config.get<boolean>('hover.enabled', true);
        
        if (!enabled) {
            return undefined;
        }

        const header = findFunctionHeader(
            document,
            position,
            config.get<number>('hover.maxScanLines', 20)
        );
        if (!header) {
            return undefined;
        }

        const parserChoice = config.get<'regex' | 'tree-sitter'>('parser', 'tree-sitter');
        const goFunc = parserChoice === 'tree-sitter'
            ? await TreeSitterGoParser.parseFunction(header.text)
            : GoFunctionParser.parseFunction(header.text);
        if (!goFunc) {
            return undefined;
        }

        const output = config.get<'signature' | 'method' | 'class'>('hover.output', 'signature');
        const options = {
            isStatic: true,
            addComments: false,
            handleErrorsAsExceptions: true
        };

        let javaPreview: string;

        if (output === 'method') {
            javaPreview = JavaCodeGenerator.generateJavaMethod(goFunc, options);
        } else if (output === 'class') {
            javaPreview = JavaCodeGenerator.generateFullJavaClass(goFunc, 'GoConverter', options);
        } else {
            const method = JavaCodeGenerator.generateJavaMethod(goFunc, options);
            const sigLine = method.split('\n').find(l => l.trim().startsWith('public')) || '';
            javaPreview = sigLine.trim().replace(/\s*\{\s*$/, ';');
        }

        const md = new vscode.MarkdownString();
        md.appendMarkdown('**Java Equivalent:**\n\n');
        md.appendCodeblock(javaPreview, 'java');
        return new vscode.Hover(md, header.range);
    }
}
