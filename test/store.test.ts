import { describe, it, expect } from 'vitest';
import {
  CommandItem,
  CommandStore,
  GroupNode,
} from '../src/types';
import {
  StateStorage,
  createGroup,
  generateId,
  validateStore,
  readStore,
  readLanguage,
  writeLanguage,
  parseImportedJson,
  serializeStore,
  mergeStores,
  findGroup,
  findCommand,
  addGroupItem,
  addCommandItem,
  upsertCommand,
  deleteGroup,
  deleteCommand,
  renameGroup,
  renameCommand,
  toggleCollapse,
  moveGroup,
  moveCommand,
  validateCommandInput,
} from '../src/store';

function group(name: string, collapsed = false): GroupNode {
  return { id: generateId(), name, commands: [], groups: [], collapsed };
}

function command(name: string, commandText = 'echo hi'): CommandItem {
  return { id: generateId(), name, command: commandText, description: '', parameters: [] };
}

function fakeStorage(data: unknown): StateStorage {
  let value = data;
  return {
    get: () => value as never,
    update: async (_k, v) => {
      value = v;
    },
  };
}

describe('store 校验', () => {
  it('validateStore 接受合法结构', () => {
    const s: CommandStore = [
      { id: 'g1', name: 'g', commands: [{ id: 'c1', name: 'c', command: 'x', description: '', parameters: [] }], groups: [], collapsed: false },
    ];
    expect(validateStore(s)).toBe(true);
  });

  it('validateStore 拒绝非法结构', () => {
    expect(validateStore(null)).toBe(false);
    expect(validateStore({})).toBe(false);
    expect(validateStore([{ id: 'g1' }])).toBe(false);
    expect(validateStore([{ id: 'g1', name: 'g', commands: [{ id: 'c1' }], groups: [], collapsed: false }])).toBe(false);
  });

  it('readStore 在数据损坏时回退为空 store', () => {
    expect(readStore(fakeStorage({ nope: 1 }))).toEqual([]);
    expect(readStore(fakeStorage(undefined))).toEqual([]);
    const good: CommandStore = [];
    expect(readStore(fakeStorage(good))).toEqual([]);
  });
});

describe('导入 / 导出', () => {
  it('parseImportedJson 处理非法 JSON', () => {
    const r = parseImportedJson('not json');
    expect(r.ok).toBe(false);
  });

  it('parseImportedJson 处理结构不符', () => {
    const r = parseImportedJson(JSON.stringify({ foo: 1 }));
    expect(r.ok).toBe(false);
  });

  it('parseImportedJson 接受合法数据并往返序列化', () => {
    const s: CommandStore = [group('g1')];
    const r = parseImportedJson(serializeStore(s));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.store).toEqual(s);
  });

  it('mergeStores 追加新分组、按 id 去重且导入优先', () => {
    const g1 = group('g1');
    const existing: CommandStore = [{ ...g1, name: '旧分组' }];
    const g1Incoming = { ...g1, name: '新分组' };
    const g2 = group('g2');
    const incoming: CommandStore = [g1Incoming, g2];

    const merged = mergeStores(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(merged.find((g) => g.id === g1.id)!.name).toBe('新分组');
    expect(merged.find((g) => g.id === g2.id)).toBeTruthy();
  });
});

describe('树操作', () => {
  it('addGroupItem 支持顶层与嵌套', () => {
    const root = group('root');
    let s: CommandStore = [root];
    s = addGroupItem(s, undefined, createGroup('top'));
    expect(s).toHaveLength(2);

    const child = createGroup('child');
    s = addGroupItem(s, root.id, child);
    expect(findGroup(s, root.id)!.groups).toHaveLength(1);
    expect(findGroup(s, child.id)!.name).toBe('child');
  });

  it('addCommandItem / upsertCommand', () => {
    const g = group('g');
    let s: CommandStore = [g];
    const c = command('cmd');
    s = addCommandItem(s, g.id, c);
    expect(findCommand(s, c.id)!.command.name).toBe('cmd');

    const updated = { ...c, name: 'renamed' };
    s = upsertCommand(s, updated);
    expect(findCommand(s, c.id)!.command.name).toBe('renamed');
  });

  it('deleteGroup / deleteCommand', () => {
    const g = group('g');
    const c = command('c');
    let s: CommandStore = [{ ...g, commands: [c] }];
    s = deleteCommand(s, c.id);
    expect(findCommand(s, c.id)).toBeUndefined();
    s = deleteGroup(s, g.id);
    expect(s).toHaveLength(0);
  });

  it('renameGroup / renameCommand / toggleCollapse', () => {
    const g = group('g');
    const c = command('c');
    let s: CommandStore = [{ ...g, commands: [c] }];
    s = renameGroup(s, g.id, 'g2');
    expect(findGroup(s, g.id)!.name).toBe('g2');
    s = renameCommand(s, c.id, 'c2');
    expect(findCommand(s, c.id)!.command.name).toBe('c2');
    s = toggleCollapse(s, g.id, true);
    expect(findGroup(s, g.id)!.collapsed).toBe(true);
  });

  it('moveGroup / moveCommand 交换顺序', () => {
    const a = group('a');
    const b = group('b');
    let s: CommandStore = [a, b];
    s = moveGroup(s, b.id, 'up');
    expect(s[0].id).toBe(b.id);

    const c1 = command('c1');
    const c2 = command('c2');
    const g = { ...group('g'), commands: [c1, c2] };
    s = [g];
    s = moveCommand(s, c2.id, 'up');
    expect(s[0].commands[0].id).toBe(c2.id);
  });

  it('validateCommandInput 校验空命令与名称重复', () => {
    const g = group('g');
    const c = command('a');
    const store: CommandStore = [{ ...g, commands: [c] }];

    expect(validateCommandInput(store, g.id, { ...c, command: '' })).toBe('empty-command');
    expect(validateCommandInput(store, g.id, { ...c, name: '' })).toBe('empty-name');
    // 同组内同名
    const c2 = command('a');
    expect(validateCommandInput(store, g.id, c2)).toBe('duplicate-name');
    // 自己不算重复
    expect(validateCommandInput(store, g.id, c)).toBeNull();
  });
});

describe('语言持久化', () => {
  it('readLanguage 默认 zh，写读往返', async () => {
    const s = fakeStorage(undefined);
    expect(readLanguage(s)).toBe('zh');
    await writeLanguage(s, 'en');
    expect(readLanguage(s)).toBe('en');
    await writeLanguage(s, 'zh');
    expect(readLanguage(s)).toBe('zh');
  });
});
