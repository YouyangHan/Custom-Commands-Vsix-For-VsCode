import { describe, it, expect, vi } from 'vitest';
import {
  extractParameterNames,
  replaceParameters,
  selectParameterValues,
  ParameterSelectionDeps,
  ParameterOption,
} from '../src/parameterResolver';
import { CommandItem } from '../src/types';

function makeDeps(overrides: Partial<ParameterSelectionDeps> = {}): ParameterSelectionDeps {
  return {
    resolveVariables: (t) => t,
    listSubDirectories: async () => [],
    pickOption: async () => undefined,
    ...overrides,
  };
}

function command(partial: Partial<CommandItem> = {}): CommandItem {
  return {
    id: 'c1',
    name: 'cmd',
    command: '',
    description: '',
    parameters: [],
    ...partial,
  };
}

describe('extractParameterNames', () => {
  it('提取并去重、保序', () => {
    expect(extractParameterNames('echo {{a}} and {{b}} and {{a}}')).toEqual(['a', 'b']);
  });

  it('忽略空白占位符', () => {
    expect(extractParameterNames('{{}} {{ a }}')).toEqual(['a']);
  });

  it('无参数返回空数组', () => {
    expect(extractParameterNames('echo hi')).toEqual([]);
  });
});

describe('replaceParameters', () => {
  it('替换已提供的参数，保留未提供的', () => {
    expect(replaceParameters('{{a}} {{b}}', { a: '1' })).toBe('1 {{b}}');
  });
});

describe('selectParameterValues', () => {
  it('无参数直接返回原命令', async () => {
    const pick = vi.fn();
    const deps = makeDeps({ pickOption: pick });
    const res = await selectParameterValues(command({ command: 'echo hi' }), {}, deps);
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.replaced).toBe('echo hi');
    expect(pick).not.toHaveBeenCalled();
  });

  it('options 类型：默认值优先预选，替换结果正确', async () => {
    const pick = vi.fn(async (_o, preselect) => {
      expect(preselect).toBe('b');
      return 'b';
    });
    const deps = makeDeps({ pickOption: pick });
    const cmd = command({
      command: 'echo {{env}}',
      parameters: [
        { name: 'env', label: '环境', type: 'options', options: ['a', 'b', 'c'], directoryPath: '', default: 'b' },
      ],
    });
    const res = await selectParameterValues(cmd, {}, deps);
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.replaced).toBe('echo b');
  });

  it('上次选择优先于默认值', async () => {
    const pick = vi.fn(async (_o, preselect) => {
      expect(preselect).toBe('a');
      return 'a';
    });
    const deps = makeDeps({ pickOption: pick });
    const cmd = command({
      command: 'echo {{env}}',
      parameters: [
        { name: 'env', label: '环境', type: 'options', options: ['a', 'b'], directoryPath: '', default: 'b' },
      ],
    });
    const res = await selectParameterValues(cmd, { env: 'a' }, deps);
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.replaced).toBe('echo a');
  });

  it('directory 类型：解析目录路径、枚举一级子目录并以 basename 为标签', async () => {
    const list = vi.fn(async (p: string) => {
      expect(p).toBe('/ws/src');
      return ['/ws/src/a', '/ws/src/b'];
    });
    const resolve = vi.fn((t: string) => t.replace('${workspaceFolder}', '/ws'));
    const pick = vi.fn(async (options: ParameterOption[]) => {
      expect(options.map((o) => o.label)).toEqual(['a', 'b']);
      return '/ws/src/b';
    });
    const deps = makeDeps({ listSubDirectories: list, resolveVariables: resolve, pickOption: pick });
    const cmd = command({
      command: 'ls {{dir}}',
      parameters: [
        { name: 'dir', label: '目录', type: 'directory', options: [], directoryPath: '${workspaceFolder}/src' },
      ],
    });
    const res = await selectParameterValues(cmd, {}, deps);
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.replaced).toBe('ls /ws/src/b');
  });

  it('directory 读取失败返回 error', async () => {
    const deps = makeDeps({
      listSubDirectories: async () => {
        throw new Error('ENOENT');
      },
    });
    const cmd = command({
      command: 'ls {{dir}}',
      parameters: [{ name: 'dir', label: '目录', type: 'directory', options: [], directoryPath: '/nope' }],
    });
    const res = await selectParameterValues(cmd, {}, deps);
    expect(res.status).toBe('error');
    if (res.status === 'error') expect(res.code).toBe('dirNotFound');
  });

  it('用户取消返回 cancelled', async () => {
    const deps = makeDeps({ pickOption: async () => undefined });
    const cmd = command({
      command: 'echo {{env}}',
      parameters: [{ name: 'env', label: '环境', type: 'options', options: ['a'], directoryPath: '' }],
    });
    const res = await selectParameterValues(cmd, {}, deps);
    expect(res.status).toBe('cancelled');
  });

  it('无选项的占位符直接回填默认值/上次选择', async () => {
    const pick = vi.fn();
    const deps = makeDeps({ pickOption: pick });
    const cmd = command({ command: 'echo {{missing}}' }); // 未配置参数
    const res = await selectParameterValues(cmd, { missing: 'x' }, deps);
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.replaced).toBe('echo x');
    expect(pick).not.toHaveBeenCalled();
  });
});
