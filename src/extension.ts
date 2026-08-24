/**
 * 入口：注册 WebviewViewProvider、导入/导出命令、activity bar 视图。
 */
import * as vscode from 'vscode';
import { CustomCommandsPanelProvider } from './panel/panelProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new CustomCommandsPanelProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CustomCommandsPanelProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('customCommands.export', () => provider.exportCommands()),
    vscode.commands.registerCommand('customCommands.import', () => provider.importCommands())
  );
}

export function deactivate(): void {
  // 无需额外清理。
}
