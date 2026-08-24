/**
 * 终端执行：复用当前活动终端（无则新建），发送命令并回车执行。
 */
import * as vscode from 'vscode';

const TERMINAL_NAME = 'Custom Commands';

export function runInTerminal(commandText: string, execute = true): void {
  const trimmed = commandText.trim();
  if (!trimmed) return;
  const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal(TERMINAL_NAME);
  terminal.show();
  terminal.sendText(trimmed, execute);
}
