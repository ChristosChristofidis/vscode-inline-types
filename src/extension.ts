import * as vscode from 'vscode';

import { error as logError } from './log';
import { createService } from './service';
import { FileChangeTypes, Decoration, TextChange, Position, Service, Configuration, Disposable } from './types';

export function activate(extensionContext: vscode.ExtensionContext): void {
    const rootPath = vscode.workspace.rootPath;
    if (!rootPath) {
        logError(`No root path found. Aborting.`);
        return;
    }

    const subscriptions: Disposable[] = [];
    function dispose(): void {
        let nextSubscription: Disposable | undefined;
        while ((nextSubscription = subscriptions.pop()) !== undefined) {
            nextSubscription.dispose();
        }
    }
    extensionContext.subscriptions.push({ dispose });

    createServiceForExtension(rootPath, subscriptions);
    extensionContext.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('inlineTypes')) {
            dispose();
            createServiceForExtension(rootPath, subscriptions);
        }
    }));
}

function createServiceForExtension(
    rootPath: string,
    subscriptions: Disposable[]
): Service {
    const decorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({});
    subscriptions.push(decorationType);

    const configuration: Configuration = mapConfiguration(vscode.workspace.getConfiguration('inlineTypes'));
    const service = createService(
        rootPath,
        configuration,
        () => updateDecorations(configuration, decorationType, service));
    updateDecorations(configuration, decorationType, service);

    const fileWatcher = vscode.workspace.createFileSystemWatcher('{!node_modules,**}/*.{ts,js,tsx,jsx}');
    fileWatcher.onDidCreate(e => service.notifyFileChange(normalizeFileName(e.fsPath), FileChangeTypes.Created));
    fileWatcher.onDidChange(e => service.notifyFileChange(normalizeFileName(e.fsPath), FileChangeTypes.Changed));
    fileWatcher.onDidDelete(e => service.notifyFileChange(normalizeFileName(e.fsPath), FileChangeTypes.Deleted));
    subscriptions.push(fileWatcher);

    vscode.window.onDidChangeActiveTextEditor(() => updateDecorations(configuration, decorationType, service));
    vscode.workspace.onDidChangeTextDocument(e => service.notifyDocumentChange(
        normalizeFileName(e.document.fileName),
        e.contentChanges.map(mapContentChange)));

    return service;
}

function mapConfiguration(configuration: vscode.WorkspaceConfiguration): Configuration {
    return {
        features: configuration.features,
        updateDelay: configuration.updateDelay,
        decorationStyle: configuration.decorationStyle,
        highlightStyle: configuration.highlightStyle,
        highlightColor: configuration.highlightColor,
    };
}

function updateDecorations(
    configuration: Configuration,
    decorationType: vscode.TextEditorDecorationType,
    service: Service
): void {
    const visibleTextEditors = vscode.window.visibleTextEditors.filter(isSupportedLanguage);
    for (const visibleTextEditor of visibleTextEditors) {
        const fileName = visibleTextEditor.document.fileName;
        const decorations = service.getDecorations(normalizeFileName(fileName));
        const decorationOptions = decorations.reduce<vscode.DecorationOptions[]>((arr, d) => arr.concat(createDecorationOptions(configuration, d)), []);
        visibleTextEditor.setDecorations(decorationType, decorationOptions);
    }
}

function createDecorationOptions(configuration: Configuration, decoration: Decoration): vscode.DecorationOptions[] {
    const textDecoration = `none; ${decoration.isWarning ? configuration.highlightStyle : configuration.decorationStyle}`;
    const startPosition = mapServicePosition(decoration.startPosition);
    const endPosition = mapServicePosition(decoration.endPosition);
    const nextEndPosition = mapServicePosition(decoration.endPosition, 1);
    const lightThemeColor = decoration.isWarning ? configuration.highlightColor : "black";
    const darkThemeColor = decoration.isWarning ? configuration.highlightColor : "white";
    const decos: vscode.DecorationOptions[] = [];
    if (decoration.hoverMessage) {
        decos.push({
            range: new vscode.Range(startPosition, endPosition),
            hoverMessage: decoration.hoverMessage
        });
    }
    if (decoration.textBefore) {
        decos.push({
            range: new vscode.Range(startPosition, endPosition),
            renderOptions: {
                light: {
                    before: { contentText: decoration.textBefore, textDecoration, color: lightThemeColor },
                },
                dark: {
                    before: { contentText: decoration.textBefore, textDecoration, color: darkThemeColor },
                }
            }
        });
    }
    if (decoration.textAfter) {
        decos.push({
            range: new vscode.Range(endPosition, nextEndPosition),
            renderOptions: {
                light: {
                    before: { contentText: decoration.textAfter, textDecoration, color: lightThemeColor },
                },
                dark: {
                    before: { contentText: decoration.textAfter, textDecoration, color: darkThemeColor },
                }
            }
        });
    }
    return decos;
}

function mapContentChange(contentChange: vscode.TextDocumentContentChangeEvent): TextChange {
    return {
        start: contentChange.range.start,
        end: contentChange.range.end,
        newText: contentChange.text
    };
}

function mapServicePosition(position: Position, offset: number = 0): vscode.Position {
    return new vscode.Position(position.line, position.character + offset);
}

function normalizeFileName(fileName: string): string {
    return fileName.replace(/\\/g, '/');
}

const SUPPORTED_LANGUAGES = ['typescript', 'javascript', 'javascriptreact', 'typescriptreact'];

function isSupportedLanguage(value: vscode.TextEditor): boolean {
    return SUPPORTED_LANGUAGES.includes(value.document.languageId);
}
