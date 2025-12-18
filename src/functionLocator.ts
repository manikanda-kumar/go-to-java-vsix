import * as vscode from 'vscode';

export interface GoFunctionHeader {
    text: string;
    range: vscode.Range;
}

/**
 * Locate a Go function header around the given position.
 * Scans up to maxScanLines above and below to capture multi-line signatures.
 */
export function findFunctionHeader(
    document: vscode.TextDocument,
    position: vscode.Position,
    maxScanLines: number = 20
): GoFunctionHeader | undefined {
    let start = position.line;

    // Walk upwards to find the func keyword
    for (let i = position.line; i >= Math.max(0, position.line - maxScanLines); i--) {
        const line = document.lineAt(i).text;
        if (line.trim().startsWith('func')) {
            start = i;
            break;
        }
    }

    if (!document.lineAt(start).text.trim().startsWith('func')) {
        return undefined;
    }

    const end = Math.min(document.lineCount - 1, start + maxScanLines);
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
