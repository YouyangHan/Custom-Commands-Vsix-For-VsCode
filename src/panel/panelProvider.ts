/**
 * WebviewViewProvider：负责渲染面板、消息路由，以及命令执行/参数选择/导入导出编排。
 * 原生弹窗文案通过 i18n 模块按当前语言本地化。
 */
import * as vscode from 'vscode';
import * as path from 'node:path';
import { CommandItem, CommandStore, Language } from '../types';
import * as ops from '../store';
import { resolveVariables, VariableContext } from '../variableResolver';
import { listSubDirectories, replaceParameters, ParameterOption } from '../parameterResolver';
import { runInTerminal } from '../terminal';
import { t, fill, MessageKey } from '../i18n';

const COMMAND_INPUT_ERROR_KEY: Record<ops.CommandInputError, MessageKey> = {
  'empty-name': 'err.emptyName',
  'empty-command': 'err.emptyCommand',
  'duplicate-name': 'err.duplicateName',
};

const IMPORT_ERROR_KEY: Record<ops.ImportError, MessageKey> = {
  'invalid-json': 'err.invalidJson',
  'invalid-structure': 'err.invalidStructure',
};

export class CustomCommandsPanelProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'customCommands.view';

  private view: vscode.WebviewView | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
    this.postStore();
  }

  /** 供命令面板触发的导入/导出在完成后刷新已打开的视图。 */
  refresh(): void {
    this.postStore();
  }

  async exportCommands(): Promise<void> {
    const store = ops.readStore(this.context.globalState);
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('custom-commands.json'),
      filters: { JSON: ['json'] },
    });
    if (!uri) return;
    try {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(ops.serializeStore(store), 'utf8'));
      this.postStatus(this.tf('export.done', { path: uri.fsPath }), 'info');
    } catch (e) {
      this.postStatus(this.tf('export.fail', { e: String(e) }), 'error');
    }
  }

  async importCommands(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { JSON: ['json'] },
    });
    if (!uris || uris.length === 0) return;
    const uri = uris[0];

    let text: string;
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch (e) {
      this.postStatus(this.tf('import.readFail', { e: String(e) }), 'error');
      return;
    }

    const parsed = ops.parseImportedJson(text);
    if (!parsed.ok) {
      this.postStatus(this.tr(IMPORT_ERROR_KEY[parsed.error]), 'error');
      return;
    }

    const overwriteLabel = this.tr('import.overwrite');
    const mergeLabel = this.tr('import.merge');
    const mode = await vscode.window.showQuickPick([overwriteLabel, mergeLabel], {
      title: this.tr('import.modeTitle'),
      placeHolder: this.tr('import.modeTitle'),
    });
    if (!mode) return;

    const store = ops.readStore(this.context.globalState);
    const next = mode === overwriteLabel ? parsed.store : ops.mergeStores(store, parsed.store);
    await ops.writeStore(this.context.globalState, next);
    this.postStore();
    this.postStatus(this.tr('import.done'), 'info');
  }

  // ---------- 消息路由 ----------

  private async handleMessage(msg: {
    type: string;
    [key: string]: unknown;
  }): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.postStore();
        break;
      case 'runCommand':
        await this.runCommand(String(msg.id), msg.selections as Record<string, string> | undefined);
        break;
      case 'addGroup':
        await this.addGroup(msg.parentId as string | undefined);
        break;
      case 'addCommand':
        await this.addCommand(String(msg.groupId));
        break;
      case 'deleteGroup':
        await this.deleteGroup(String(msg.id));
        break;
      case 'deleteCommand':
        await this.deleteCommand(String(msg.id));
        break;
      case 'renameGroup':
        await this.renameGroup(String(msg.id));
        break;
      case 'renameCommand':
        await this.renameCommand(String(msg.id));
        break;
      case 'moveGroup':
        await this.mutate((s) => ops.moveGroup(s, String(msg.id), msg.direction as 'up' | 'down'));
        break;
      case 'moveCommand':
        await this.mutate((s) => ops.moveCommand(s, String(msg.id), msg.direction as 'up' | 'down'));
        break;
      case 'toggleCollapse':
        await this.mutate((s) => ops.toggleCollapse(s, String(msg.id), Boolean(msg.collapsed)));
        break;
      case 'saveCommand':
        await this.saveCommand(msg.command as CommandItem, String(msg.groupId));
        break;
      case 'setLanguage':
        await ops.writeLanguage(this.context.globalState, msg.language === 'en' ? 'en' : 'zh');
        break;
      case 'setSelections':
        await this.setSelections(String(msg.commandId), String(msg.paramName), String(msg.value));
        break;
      case 'getDirectoryOptions':
        await this.getDirectoryOptions(String(msg.commandId), String(msg.parameterName));
        break;
      case 'export':
        await this.exportCommands();
        break;
      case 'import':
        await this.importCommands();
        break;
    }
  }

  private async mutate(fn: (s: CommandStore) => CommandStore): Promise<void> {
    const store = ops.readStore(this.context.globalState);
    await ops.writeStore(this.context.globalState, fn(store));
    this.postStore();
  }

  // ---------- 增删改 ----------

  private async addGroup(parentId?: string): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: this.tr('dialog.groupName'),
      value: this.tr('default.groupName'),
      validateInput: (v) => (v.trim() ? undefined : this.tr('err.emptyName')),
    });
    if (name === undefined) return;
    await this.mutate((s) => ops.addGroupItem(s, parentId, ops.createGroup(name.trim())));
  }

  private async addCommand(groupId: string): Promise<void> {
    const store = ops.readStore(this.context.globalState);
    const command = ops.createCommand(this.tr('default.commandName'));
    await ops.writeStore(this.context.globalState, ops.addCommandItem(store, groupId, command));
    this.postStore();
    this.post({ type: 'focusEdit', id: command.id });
  }

  private async renameGroup(id: string): Promise<void> {
    const store = ops.readStore(this.context.globalState);
    const group = ops.findGroup(store, id);
    if (!group) return;
    const name = await vscode.window.showInputBox({
      prompt: this.tr('dialog.groupName'),
      value: group.name,
      validateInput: (v) => (v.trim() ? undefined : this.tr('err.emptyName')),
    });
    if (name === undefined) return;
    await this.mutate((s) => ops.renameGroup(s, id, name.trim()));
  }

  private async renameCommand(id: string): Promise<void> {
    const store = ops.readStore(this.context.globalState);
    const found = ops.findCommand(store, id);
    if (!found) return;
    const name = await vscode.window.showInputBox({
      prompt: this.tr('dialog.commandName'),
      value: found.command.name,
      validateInput: (v) => (v.trim() ? undefined : this.tr('err.emptyName')),
    });
    if (name === undefined) return;
    await this.mutate((s) => ops.renameCommand(s, id, name.trim()));
  }

  private async deleteGroup(id: string): Promise<void> {
    const store = ops.readStore(this.context.globalState);
    const group = ops.findGroup(store, id);
    if (!group) return;
    const deleteLabel = this.tr('dialog.delete');
    const answer = await vscode.window.showWarningMessage(
      this.tf('dialog.deleteGroup', { name: group.name }),
      { modal: true },
      deleteLabel
    );
    if (answer !== deleteLabel) return;
    await this.mutate((s) => ops.deleteGroup(s, id));
  }

  private async deleteCommand(id: string): Promise<void> {
    const store = ops.readStore(this.context.globalState);
    const found = ops.findCommand(store, id);
    if (!found) return;
    const deleteLabel = this.tr('dialog.delete');
    const answer = await vscode.window.showWarningMessage(
      this.tf('dialog.deleteCommand', { name: found.command.name }),
      { modal: true },
      deleteLabel
    );
    if (answer !== deleteLabel) return;
    await this.mutate((s) => ops.deleteCommand(s, id));
  }

  private async saveCommand(command: CommandItem, groupId: string): Promise<void> {
    const store = ops.readStore(this.context.globalState);
    const err = ops.validateCommandInput(store, groupId, command);
    if (err) {
      this.post({ type: 'saveResult', ok: false, error: this.tr(COMMAND_INPUT_ERROR_KEY[err]) });
      return;
    }
    const next = ops.findCommand(store, command.id)
      ? ops.upsertCommand(store, command)
      : ops.addCommandItem(store, groupId, command);
    await ops.writeStore(this.context.globalState, next);
    this.post({ type: 'saveResult', ok: true });
    this.postStore();
  }

  // ---------- 执行 ----------

  private async runCommand(id: string, selections?: Record<string, string>): Promise<void> {
    const store = ops.readStore(this.context.globalState);
    const found = ops.findCommand(store, id);
    if (!found) {
      this.postStatus(this.tr('error.notFound'), 'error');
      return;
    }
    const replaced = replaceParameters(found.command.command, selections ?? {});
    const finalText = resolveVariables(replaced, buildVariableContext());
    runInTerminal(finalText, found.command.execute !== false);
  }

  private async setSelections(commandId: string, paramName: string, value: string): Promise<void> {
    const all = ops.readLastSelections(this.context.globalState);
    if (!all[commandId]) all[commandId] = {};
    all[commandId][paramName] = value;
    await ops.writeLastSelections(this.context.globalState, all);
  }

  private async getDirectoryOptions(commandId: string, parameterName: string): Promise<void> {
    const store = ops.readStore(this.context.globalState);
    const found = ops.findCommand(store, commandId);
    if (!found) return;
    const param = found.command.parameters.find((p) => p.name === parameterName);
    if (!param || param.type !== 'directory') return;
    const dirPath = resolveVariables(param.directoryPath, buildVariableContext());
    try {
      const dirs = await listSubDirectories(dirPath);
      const options: ParameterOption[] = dirs.map((d) => {
        const full = d;
        const base = path.basename(d);
        return param.fullPath ? { label: full, value: full } : { label: base, value: base };
      });
      this.post({ type: 'directoryOptions', commandId, parameterName, options });
    } catch {
      this.post({
        type: 'directoryOptions',
        commandId,
        parameterName,
        options: [],
        error: this.tf('err.dirNotFound', { dir: dirPath }),
      });
    }
  }

  // ---------- 消息发送 ----------

  private post(msg: unknown): void {
    this.view?.webview.postMessage(msg);
  }

  private postStore(): void {
    this.post({
      type: 'setStore',
      store: ops.readStore(this.context.globalState),
      language: ops.readLanguage(this.context.globalState),
      lastSelections: ops.readLastSelections(this.context.globalState),
    });
  }

  private postStatus(message: string, level: 'info' | 'error'): void {
    this.post({ type: 'status', message, level });
  }

  // ---------- 本地化 ----------

  private tr(key: MessageKey): string {
    return t(ops.readLanguage(this.context.globalState), key);
  }

  private tf(key: MessageKey, vars: Record<string, string>): string {
    return fill(this.tr(key), vars);
  }

  // ---------- HTML ----------

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Custom Commands Output</title>
</head>
<body>
  <div id="tabs">
    <button id="tab-run" class="tab active">执行命令</button>
    <button id="tab-config" class="tab">配置命令</button>
    <button id="tab-settings" class="tab">设置</button>
  </div>
  <div id="toolbar">
    <button id="add-root-group" class="toolbar-btn">＋</button>
    <button id="import-btn" class="toolbar-btn">Import</button>
    <button id="export-btn" class="toolbar-btn">Export</button>
  </div>
  <div id="tree"></div>
  <div id="editor"></div>
  <div id="settings"></div>
  <div id="status"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/** 读取当前 vscode 环境，构建变量上下文。 */
function buildVariableContext(): VariableContext {
  const editor = vscode.window.activeTextEditor;
  const doc = editor?.document;
  const file = doc?.fileName;

  let fileDirname: string | undefined;
  let fileBasename: string | undefined;
  let fileBasenameNoExtension: string | undefined;
  let fileExtname: string | undefined;
  let relativeFile: string | undefined;
  if (file) {
    fileDirname = path.dirname(file);
    fileBasename = path.basename(file);
    fileExtname = path.extname(file);
    fileBasenameNoExtension =
      fileExtname && fileBasename.endsWith(fileExtname)
        ? fileBasename.slice(0, -fileExtname.length)
        : fileBasename;
    if (doc?.uri) {
      relativeFile = vscode.workspace.asRelativePath(doc.uri, false);
    }
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const workspaceFolderBasename = workspaceFolder ? path.basename(workspaceFolder) : undefined;

  const selection = editor?.selection;
  const selectedText = selection && !selection.isEmpty ? doc?.getText(selection) : undefined;
  const lineNumber = selection ? selection.active.line + 1 : undefined;

  return {
    file,
    fileDirname,
    fileBasename,
    fileBasenameNoExtension,
    fileExtname,
    relativeFile,
    workspaceFolder,
    workspaceFolderBasename,
    selectedText,
    lineNumber,
    env: process.env as Record<string, string | undefined>,
  };
}
