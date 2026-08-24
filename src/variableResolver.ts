/**
 * ${内置变量} 替换。纯函数，不依赖 vscode；
 * 由调用方（extension / panelProvider）构建 VariableContext。
 *
 * 解析规则：识别的变量取值（无值时替换为空串），未识别的 `${...}` 原样保留。
 */

export interface VariableContext {
  file?: string;
  fileDirname?: string;
  fileBasename?: string;
  fileBasenameNoExtension?: string;
  fileExtname?: string;
  relativeFile?: string;
  workspaceFolder?: string;
  workspaceFolderBasename?: string;
  selectedText?: string;
  lineNumber?: number;
  env?: Record<string, string | undefined>;
}

const KNOWN_VARIABLES = new Set([
  'file',
  'fileDirname',
  'fileBasename',
  'fileBasenameNoExtension',
  'fileExtname',
  'relativeFile',
  'workspaceFolder',
  'workspaceFolderBasename',
  'selectedText',
  'lineNumber',
]);

export function resolveVariables(text: string, ctx: VariableContext): string {
  return text.replace(/\$\{([^{}]+)\}/g, (match, expr: string) => {
    const name = expr.trim();
    if (name.startsWith('env:')) {
      const envName = name.slice('env:'.length).trim();
      const val = ctx.env?.[envName];
      return val !== undefined ? val : '';
    }
    if (KNOWN_VARIABLES.has(name)) {
      const val = (ctx as Record<string, unknown>)[name];
      return val !== undefined && val !== null ? String(val) : '';
    }
    return match;
  });
}
