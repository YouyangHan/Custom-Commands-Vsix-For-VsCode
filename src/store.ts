/**
 * 存储读写、导入导出、数据校验，以及树形结构的查询与增删改操作。
 *
 * 本模块不依赖 vscode，仅依赖一个结构化的 StateStorage 接口
 * （context.globalState 满足该接口），因此可独立做单元测试。
 */
import { randomUUID } from 'node:crypto';
import {
  CommandItem,
  CommandParameter,
  CommandStore,
  GroupNode,
  Language,
  LastSelections,
} from './types';

/** globalState 的最小结构化接口。 */
export interface StateStorage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

const STORE_KEY = 'customCommands';
const LAST_SELECTIONS_KEY = 'lastSelections';
const LANGUAGE_KEY = 'language';

export function generateId(): string {
  return randomUUID();
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------- 工厂 ----------

export function createGroup(name: string): GroupNode {
  return { id: generateId(), name, commands: [], groups: [], collapsed: false };
}

export function createCommand(name = ''): CommandItem {
  return { id: generateId(), name, command: '', description: '', parameters: [] };
}

// ---------- 校验 ----------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function isCommandParameter(v: unknown): v is CommandParameter {
  if (!isRecord(v)) return false;
  return (
    typeof v.name === 'string' &&
    typeof v.label === 'string' &&
    (v.type === 'options' || v.type === 'directory') &&
    Array.isArray(v.options) &&
    v.options.every((o) => typeof o === 'string') &&
    typeof v.directoryPath === 'string' &&
    (v.default === undefined || typeof v.default === 'string')
  );
}

export function isCommandItem(v: unknown): v is CommandItem {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.command === 'string' &&
    typeof v.description === 'string' &&
    Array.isArray(v.parameters) &&
    v.parameters.every(isCommandParameter)
  );
}

export function isGroupNode(v: unknown): v is GroupNode {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    Array.isArray(v.commands) &&
    v.commands.every(isCommandItem) &&
    Array.isArray(v.groups) &&
    v.groups.every(isGroupNode) &&
    typeof v.collapsed === 'boolean'
  );
}

export function validateStore(v: unknown): v is CommandStore {
  return Array.isArray(v) && v.every(isGroupNode);
}

// ---------- 存储读写 ----------

export function readStore(storage: StateStorage): CommandStore {
  try {
    const data = storage.get<unknown>(STORE_KEY);
    if (data === undefined) return [];
    if (!validateStore(data)) {
      console.warn('[Custom Commands] 存储数据损坏，已回退为空 store');
      return [];
    }
    return data;
  } catch (e) {
    console.warn('[Custom Commands] 读取存储失败', e);
    return [];
  }
}

export async function writeStore(storage: StateStorage, store: CommandStore): Promise<void> {
  await storage.update(STORE_KEY, store);
}

export function readLastSelections(storage: StateStorage): LastSelections {
  try {
    const data = storage.get<LastSelections>(LAST_SELECTIONS_KEY);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    return {};
  } catch {
    return {};
  }
}

export async function writeLastSelections(
  storage: StateStorage,
  sel: LastSelections
): Promise<void> {
  await storage.update(LAST_SELECTIONS_KEY, sel);
}

export function readLanguage(storage: StateStorage): Language {
  const v = storage.get<string>(LANGUAGE_KEY);
  return v === 'en' ? 'en' : 'zh';
}

export async function writeLanguage(storage: StateStorage, lang: Language): Promise<void> {
  await storage.update(LANGUAGE_KEY, lang);
}

// ---------- 导入 / 导出 ----------

export function serializeStore(store: CommandStore): string {
  return JSON.stringify(store, null, 2);
}

export type ImportError = 'invalid-json' | 'invalid-structure';

export type ParseResult =
  | { ok: true; store: CommandStore }
  | { ok: false; error: ImportError };

export function parseImportedJson(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
  if (!validateStore(data)) {
    return { ok: false, error: 'invalid-structure' };
  }
  return { ok: true, store: data };
}

/** 追加合并：按 id 去重，冲突时导入内容优先。 */
export function mergeStores(existing: CommandStore, incoming: CommandStore): CommandStore {
  const result = deepClone(existing);
  for (const inGroup of incoming) {
    const target = result.find((g) => g.id === inGroup.id);
    if (target) {
      mergeGroupInto(target, inGroup);
    } else {
      result.push(deepClone(inGroup));
    }
  }
  return result;
}

function mergeGroupInto(target: GroupNode, source: GroupNode): void {
  target.name = source.name;
  target.collapsed = source.collapsed;
  for (const cmd of source.commands) {
    const idx = target.commands.findIndex((c) => c.id === cmd.id);
    if (idx !== -1) target.commands[idx] = deepClone(cmd);
    else target.commands.push(deepClone(cmd));
  }
  for (const sg of source.groups) {
    const t = target.groups.find((g) => g.id === sg.id);
    if (t) mergeGroupInto(t, sg);
    else target.groups.push(deepClone(sg));
  }
}

// ---------- 树查询 ----------

export function findGroup(store: CommandStore, id: string): GroupNode | undefined {
  for (const g of store) {
    if (g.id === id) return g;
    const found = findGroup(g.groups, id);
    if (found) return found;
  }
  return undefined;
}

export function findCommand(
  store: CommandStore,
  id: string
): { command: CommandItem; group: GroupNode } | undefined {
  for (const g of store) {
    const cmd = g.commands.find((c) => c.id === id);
    if (cmd) return { command: cmd, group: g };
    const nested = findCommand(g.groups, id);
    if (nested) return nested;
  }
  return undefined;
}

// ---------- 树变更 ----------

export function addGroupItem(store: CommandStore, parentId: string | undefined, group: GroupNode): CommandStore {
  if (!parentId) return [...store, group];
  return store.map((g) =>
    g.id === parentId
      ? { ...g, groups: [...g.groups, group] }
      : { ...g, groups: addGroupItem(g.groups, parentId, group) }
  );
}

export function addGroup(store: CommandStore, parentId?: string): CommandStore {
  return addGroupItem(store, parentId, createGroup('新分组'));
}

export function addCommandItem(store: CommandStore, groupId: string, command: CommandItem): CommandStore {
  return store.map((g) =>
    g.id === groupId
      ? { ...g, commands: [...g.commands, command] }
      : { ...g, groups: addCommandItem(g.groups, groupId, command) }
  );
}

export function addCommand(store: CommandStore, groupId: string): CommandStore {
  return addCommandItem(store, groupId, createCommand('新命令'));
}

/** 按 id 覆盖已存在的命令（不存在时不做任何改动）。 */
export function upsertCommand(store: CommandStore, command: CommandItem): CommandStore {
  return store.map((g) => ({
    ...g,
    commands: g.commands.map((c) => (c.id === command.id ? command : c)),
    groups: upsertCommand(g.groups, command),
  }));
}

export function deleteGroup(store: CommandStore, id: string): CommandStore {
  return store
    .filter((g) => g.id !== id)
    .map((g) => ({ ...g, groups: deleteGroup(g.groups, id) }));
}

export function deleteCommand(store: CommandStore, id: string): CommandStore {
  return store.map((g) => ({
    ...g,
    commands: g.commands.filter((c) => c.id !== id),
    groups: deleteCommand(g.groups, id),
  }));
}

export function renameGroup(store: CommandStore, id: string, name: string): CommandStore {
  return store.map((g) =>
    g.id === id ? { ...g, name } : { ...g, groups: renameGroup(g.groups, id, name) }
  );
}

export function renameCommand(store: CommandStore, id: string, name: string): CommandStore {
  return store.map((g) => ({
    ...g,
    commands: g.commands.map((c) => (c.id === id ? { ...c, name } : c)),
    groups: renameCommand(g.groups, id, name),
  }));
}

export function toggleCollapse(store: CommandStore, id: string, collapsed: boolean): CommandStore {
  return store.map((g) =>
    g.id === id ? { ...g, collapsed } : { ...g, groups: toggleCollapse(g.groups, id, collapsed) }
  );
}

export function moveGroup(store: CommandStore, id: string, direction: 'up' | 'down'): CommandStore {
  const idx = store.findIndex((g) => g.id === id);
  if (idx !== -1) return moveInArray(store, idx, direction);
  return store.map((g) => ({ ...g, groups: moveGroup(g.groups, id, direction) }));
}

export function moveCommand(store: CommandStore, id: string, direction: 'up' | 'down'): CommandStore {
  return store.map((g) => {
    const idx = g.commands.findIndex((c) => c.id === id);
    if (idx !== -1) return { ...g, commands: moveInArray(g.commands, idx, direction) };
    return { ...g, groups: moveCommand(g.groups, id, direction) };
  });
}

function moveInArray<T>(arr: T[], index: number, direction: 'up' | 'down'): T[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= arr.length) return arr;
  const copy = arr.slice();
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

export type CommandInputError = 'empty-name' | 'empty-command' | 'duplicate-name';

/** 保存命令前的校验：命令非空、名称非空、同组内名称不重复（返回错误码，由调用方本地化）。 */
export function validateCommandInput(
  store: CommandStore,
  groupId: string | undefined,
  command: CommandItem
): CommandInputError | null {
  if (!command.name.trim()) return 'empty-name';
  if (!command.command.trim()) return 'empty-command';
  const group = groupId ? findGroup(store, groupId) : undefined;
  if (group) {
    const dup = group.commands.find((c) => c.id !== command.id && c.name === command.name);
    if (dup) return 'duplicate-name';
  }
  return null;
}
