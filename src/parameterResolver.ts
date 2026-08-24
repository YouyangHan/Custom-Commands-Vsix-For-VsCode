/**
 * {{参数}} 解析与选择流程（含目录枚举）。
 * 纯逻辑，通过 ParameterSelectionDeps 注入 vscode 相关能力，便于单元测试。
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CommandItem } from './types';

export interface ParameterOption {
  label: string;
  value: string;
}

export interface ParameterSelectionDeps {
  resolveVariables: (text: string) => string;
  listSubDirectories: (dirPath: string) => Promise<string[]>;
  pickOption: (
    options: ParameterOption[],
    preselectValue: string | undefined,
    title: string
  ) => Promise<string | undefined>;
  /** 构建选择器标题（用于本地化）；缺省使用中文模板。 */
  selectTitle?: (commandName: string, label: string) => string;
}

export type ParameterSelectionResult =
  | { status: 'ok'; selections: Record<string, string>; replaced: string }
  | { status: 'cancelled' }
  | { status: 'error'; code: 'dirNotFound'; dirPath: string };

/** 从命令文本中提取所有 {{参数名}}（去重、保序、去除空白）。 */
export function extractParameterNames(text: string): string[] {
  const names: string[] = [];
  const re = /\{\{([^{}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1].trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** 用选中值替换命令文本中的 {{参数名}}；未提供的参数保留原占位符。 */
export function replaceParameters(text: string, selections: Record<string, string>): string {
  return text.replace(/\{\{([^{}]+)\}\}/g, (match, name: string) => {
    const key = name.trim();
    return selections[key] !== undefined ? selections[key] : match;
  });
}

/** 列出目录下的一级子文件夹（返回完整路径）。 */
export async function listSubDirectories(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(dirPath, e.name));
}

/**
 * 逐参数执行选择流程：
 * 预选优先级：上次持久化选择 → 配置的默认值 → 列表第一项。
 */
export async function selectParameterValues(
  command: CommandItem,
  lastSelections: Record<string, string> | undefined,
  deps: ParameterSelectionDeps
): Promise<ParameterSelectionResult> {
  const names = extractParameterNames(command.command);
  if (names.length === 0) {
    return { status: 'ok', selections: {}, replaced: command.command };
  }

  const selections: Record<string, string> = {};
  for (const name of names) {
    const param = command.parameters.find((p) => p.name === name);

    let options: ParameterOption[] = [];
    if (param && param.type === 'options') {
      options = param.options.map((o) => ({ label: o, value: o }));
    } else if (param && param.type === 'directory') {
      const dirPath = deps.resolveVariables(param.directoryPath);
      let dirs: string[];
      try {
        dirs = await deps.listSubDirectories(dirPath);
      } catch {
        return { status: 'error', code: 'dirNotFound', dirPath };
      }
      options = dirs.map((d) => ({ label: path.basename(d), value: d }));
    }

    if (options.length === 0) {
      // 无可选项（占位符未配置参数）：直接使用上次选择 / 默认值 / 空串。
      selections[name] = lastSelections?.[name] ?? param?.default ?? '';
      continue;
    }

    const candidates = [lastSelections?.[name], param?.default].filter(
      (v): v is string => typeof v === 'string' && v !== ''
    );
    const preselect = candidates.find((v) => options.some((o) => o.value === v));

    const title = deps.selectTitle
      ? deps.selectTitle(command.name, param?.label || name)
      : `${command.name} — 选择「${param?.label || name}」`;
    const picked = await deps.pickOption(options, preselect, title);
    if (picked === undefined) return { status: 'cancelled' };
    selections[name] = picked;
  }

  return { status: 'ok', selections, replaced: replaceParameters(command.command, selections) };
}
