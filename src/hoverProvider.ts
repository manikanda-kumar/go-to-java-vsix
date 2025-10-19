import * as vscode from 'vscode';
import { GoFunctionParser } from './goParser';
import { JavaCodeGenerator } from './javaGenerator';

interface FunctionHeader {
    text: string;
    range: vscode.Range;
}

export class GoToJavaHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const config = vscode.workspace.getConfiguration('goToJava');
        const enabled = config.get<boolean>('hover.enabled', true);
        
        if (!enabled) {
            return undefined;
        }

        const header = this.extractGoFunctionHeader(document, position);
        if (!header) {
            return undefined;
        }

        const goFunc = GoFunctionParser.parseFunction(header.text);
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
        md.isTrusted = true;

        return new vscode.Hover(md, header.range);
    }

    private extractGoFunctionHeader(
        document: vscode.TextDocument,
        position: vscode.Position
    ): FunctionHeader | undefined {
        const config = vscode.workspace.getConfiguration('goToJava');
        const maxScan = config.get<number>('hover.maxScanLines', 20);

        let start = position.line;
        
        for (let i = position.line; i >= Math.max(0, position.line - maxScan); i--) {
            const line = document.lineAt(i).text;
            if (line.trim().startsWith('func')) {
                start = i;
                break;
            }
        }

        if (!document.lineAt(start).text.trim().startsWith('func')) {
            return undefined;
        }

        const end = Math.min(document.lineCount - 1, start + maxScan);
        let headerEndLine = start;
        let headerEndChar = document.lineAt(start).text.length;

        for (let i = start; i <= end; i++) {
            const text = document.lineAt(i).text;
            const braceIdx = text.indexOf('{');
            if (braceIdx >= 0) {
                headerEndLine = i;
                headerEndChar = braceIdx;
                break;
            }
            headerEndLine = i;
            headerEndChar = text.length;
        }

        const range = new vscode.Range(start, 0, headerEndLine, headerEndChar);

        if (position.line < start || position.line > headerEndLine) {
            return undefined;
        }

        const text = document.getText(range).trim();
        return { text, range };
    }
}
