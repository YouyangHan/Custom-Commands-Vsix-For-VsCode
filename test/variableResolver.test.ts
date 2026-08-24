import { describe, it, expect } from 'vitest';
import { resolveVariables, VariableContext } from '../src/variableResolver';

const ctx: VariableContext = {
  file: '/ws/src/index.ts',
  fileDirname: '/ws/src',
  fileBasename: 'index.ts',
  fileBasenameNoExtension: 'index',
  fileExtname: '.ts',
  relativeFile: 'src/index.ts',
  workspaceFolder: '/ws',
  workspaceFolderBasename: 'ws',
  selectedText: 'hello',
  lineNumber: 42,
  env: { HOME: '/home/user' },
};

describe('variableResolver', () => {
  it('替换所有内置变量', () => {
    expect(resolveVariables('${file}', ctx)).toBe('/ws/src/index.ts');
    expect(resolveVariables('${fileDirname}', ctx)).toBe('/ws/src');
    expect(resolveVariables('${fileBasename}', ctx)).toBe('index.ts');
    expect(resolveVariables('${fileBasenameNoExtension}', ctx)).toBe('index');
    expect(resolveVariables('${fileExtname}', ctx)).toBe('.ts');
    expect(resolveVariables('${relativeFile}', ctx)).toBe('src/index.ts');
    expect(resolveVariables('${workspaceFolder}', ctx)).toBe('/ws');
    expect(resolveVariables('${workspaceFolderBasename}', ctx)).toBe('ws');
    expect(resolveVariables('${selectedText}', ctx)).toBe('hello');
    expect(resolveVariables('${lineNumber}', ctx)).toBe('42');
  });

  it('替换 env 变量', () => {
    expect(resolveVariables('${env:HOME}', ctx)).toBe('/home/user');
    expect(resolveVariables('${env:NOT_SET}', ctx)).toBe('');
  });

  it('未知变量原样保留', () => {
    expect(resolveVariables('${unknown}', ctx)).toBe('${unknown}');
  });

  it('无值时替换为空串', () => {
    expect(resolveVariables('${file}', {})).toBe('');
  });

  it('支持多个变量混合与普通文本', () => {
    expect(resolveVariables('run ${file} in ${workspaceFolder} ${unknown}', ctx)).toBe(
      'run /ws/src/index.ts in /ws ${unknown}'
    );
  });
});
