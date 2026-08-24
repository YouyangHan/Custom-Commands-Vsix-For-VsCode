# Custom Commands 插件设计文档

日期：2026-08-24
状态：待审阅

## 1. 概述

「Custom Commands」是一个 VSCode 扩展，允许用户自定义添加终端命令，持久化保存，并在 VSCode 终端中一键执行。

核心能力：

- 自定义添加命令，命令按**多级嵌套分组**组织，分组可折叠。
- 命令持久化存储，**全局共享**（所有工作区共用，重启后保留）。
- 通过 activity bar 图标打开侧栏面板；面板顶部有「执行命令」「配置命令」两个 tab。
- 命令支持**参数化**：命令文本中可定义「选择项」，执行时先选择再执行。
- 支持 VSCode 内置变量替换（`${file}` 等）。
- 支持命令的导入/导出（JSON）。

## 2. 技术栈

- **语言**：TypeScript
- **打包**：esbuild
- **面板 UI**：单个 `WebviewView`（`registerWebviewViewProvider`），纯 HTML/CSS/TS，不引入前端框架。
- **存储**：`context.globalState`（全局共享、持久化）。
- **测试**：对数据校验、变量替换、参数解析做单元测试。

## 3. 数据模型

```typescript
// 参数化命令的参数（选择项）
interface CommandParameter {
  name: string;            // 占位符名，命令中用 {{name}} 引用
  label: string;           // 选择时的显示标签
  type: 'options' | 'directory';
  options: string[];       // type = 'options'：固定选项列表
  directoryPath: string;   // type = 'directory'：目录路径（支持 ${workspaceFolder} 等内置变量）
  default?: string;        // 默认选项值
}

// 一条命令
interface CommandItem {
  id: string;
  name: string;            // 显示名
  command: string;         // 终端命令，可含 ${内置变量} 和 {{参数名}}
  description: string;     // 描述
  parameters: CommandParameter[];  // 参数列表（可为空）
}

// 分组节点（多级嵌套）
interface GroupNode {
  id: string;
  name: string;
  commands: CommandItem[];  // 该分组下的命令
  groups: GroupNode[];       // 子分组
  collapsed: boolean;        // 折叠状态，持久化
}

// 顶层结构：一组分组列表
type CommandStore = GroupNode[];
```

### 占位符约定

- `{{参数名}}`：自定义选择项，执行前由用户选择填充。
- `${内置变量}`：VSCode 内置变量，执行时由插件解析替换。

## 4. 存储

- 命令数据：`globalState.update('customCommands', store)`。
- 参数上次选择：`globalState.update('lastSelections', map)`，结构为
  `{ [commandId]: { [parameterName]: value } }`，用于下次执行时预选。
- 分组折叠状态（`collapsed`）随 `store` 一并持久化。

## 5. 面板 UI

面板为单个 WebviewView，顶部两个 tab 按钮：**执行命令** / **配置命令**。

### 5.1 执行页

- 树形展示分组与命令，分组可折叠/展开。
- 命令项显示名称；悬停显示描述与「执行」按钮。
- 点击命令执行（含参数的命令先进入参数选择，见第 7 节）。

### 5.2 配置页

- 树形展示分组与命令；每个分组/命令提供操作：添加子分组、添加命令、重命名、删除、上移、下移。
- **添加/编辑命令表单**包含：
  - 名称输入框
  - 描述输入框
  - 命令输入框 + 右侧「刷新」按钮
  - 参数配置区（见下）
- **参数解析（刷新按钮）**：点击「刷新」后，从命令文本中提取所有 `{{参数名}}` 占位符，自动生成对应数量的参数配置卡片；已存在的参数保留其配置，新占位符追加，命令中已删除的占位符对应参数移除。
- **参数配置卡片**（每张卡片一个选择框，支持多个）：
  - 名称（由占位符自动填充，可改）
  - 标签
  - 类型：`options`（固定选项）或 `directory`（目录枚举）
  - 类型为 `options` 时：选项列表，可增删每一项
  - 类型为 `directory` 时：目录路径输入框
  - 默认值

## 6. 执行流程与内置变量替换

1. 用户点击执行命令 → webview 发送 `runCommand { id }`。
2. 扩展按 id 查找命令。
3. 若命令含 `{{参数}}`，进入参数选择（见第 7 节），得到替换后的命令文本。
4. 对命令文本做内置变量替换。
5. 复用当前活动终端（无则新建），发送最终命令 + 回车执行。

### 支持的内置变量

`${file}`、`${fileDirname}`、`${fileBasename}`、`${fileBasenameNoExtension}`、
`${fileExtname}`、`${relativeFile}`、`${workspaceFolder}`、`${workspaceFolderBasename}`、
`${selectedText}`、`${lineNumber}`、`${env:NAME}`。

解析规则：自实现 `variableResolver`，按需读取 `vscode.window.activeTextEditor`、`vscode.workspace` 与环境变量；未识别的 `${...}` 原样保留。

## 7. 参数化命令（选择项）

### 7.1 参数类型

- **options**：固定选项列表，配置页手动录入每项。
- **directory**：填写目录路径（支持内置变量），执行时列出该目录下**一级子文件夹**作为选项。

### 7.2 选择流程

1. 点击含参数的命令。
2. 逐参数弹出 **VSCode 原生 QuickPick** 选择器：
   - 预选值优先级：上次持久化选择 → 配置的默认值 → 列表第一项。
   - `options` 类型直接列出选项；`directory` 类型先解析目录路径（做内置变量替换）再枚举一级子文件夹。
3. 用户确认/修改后，把该选择写入 `lastSelections` 并持久化。
4. 用选中值替换命令文本中的 `{{参数名}}`。
5. 全部参数处理完后，继续内置变量替换并执行。

### 7.3 无参数命令

命令文本不含 `{{...}}` 时，跳过参数选择，直接执行。

## 8. 导入 / 导出

- **导出**：将 `store` 序列化为 JSON，`showSaveDialog` 选路径保存。
- **导入**：`showOpenDialog` 选文件 → 读取并校验结构 → 用户选择「覆盖全部」或「追加合并」。
  - 覆盖：用导入内容替换现有 `store`。
  - 追加合并：将导入的分组/命令合并进现有 `store`（按 id 去重，冲突时导入内容优先）。

## 9. 错误处理

- 命令文本为空：保存时校验并提示。
- 名称重复：同一分组下名称重复时提示。
- 导入 JSON 解析失败或结构不符：报错并终止导入，不改动现有数据。
- 存储读取异常/损坏：回退为空 store 并告警，不崩溃。
- `directory` 类型目录不存在或无法读取：QuickPick 提示错误，不执行。

## 10. 文件结构

```
src/
  extension.ts            # 入口：注册 WebviewViewProvider、命令、activity bar
  types.ts                # 数据模型类型
  store.ts                # 存储读写、导入导出、数据校验
  variableResolver.ts     # ${内置变量} 替换
  parameterResolver.ts    # {{参数}} 解析与选择流程（含目录枚举）
  terminal.ts             # 终端执行
  panel/panelProvider.ts  # WebviewViewProvider、消息路由
  webview/                # 面板前端（打包注入）
```

## 11. 测试

- `variableResolver`：各内置变量的替换结果、未知变量保留。
- `parameterResolver`：`{{}}` 提取、options/directory 选项生成。
- `store`：导入校验、合并逻辑。

## 12. 范围（本次实现）

- 实现全部核心功能：面板、多级分组折叠、命令增删改、参数化命令、变量替换、终端执行、导入导出、持久化。
- 不做：拖拽排序（用上移/下移按钮替代）、命令执行日志、图标/主题自定义。
