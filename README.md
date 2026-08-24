# Custom Commands Output

一个 VSCode 扩展：自定义添加终端命令，持久化保存，并在 VSCode 终端中一键执行。

## 功能

- 自定义添加命令，命令按**多级嵌套分组**组织，分组可折叠。
- 命令持久化存储，**全局共享**（所有工作区共用，重启后保留）。
- 通过 activity bar 图标打开侧栏面板；面板顶部有「执行命令」「配置命令」「设置」三个 Tab。
- 命令支持**参数化**：命令文本中可定义 `{{选择项}}`，执行页内联选择后执行。
  - `options`：固定选项列表。
  - `directory`：列出目录下一级子文件夹作为选项（可勾选「包含全路径」，不勾选仅用目录名）。
- 每条命令可勾选「执行」：勾选则输入并回车执行；不勾选仅输入到终端（默认勾选）。
- 支持 VSCode 内置变量替换（`${file}` 等）。
- 支持命令的导入 / 导出（JSON），可选「覆盖全部」或「追加合并」。
- 支持**中英文切换**（设置页，持久化）。

## 安装

### 方式一：直接安装 VSIX 安装包（推荐）

1. 下载安装包：**[custom-commands-0.1.0.vsix](https://raw.githubusercontent.com/YouyangHan/Custom-Commands-Vsix-For-VsCode/main/custom-commands-0.1.0.vsix)**
   - 如果上面的链接无法下载，也可以在本仓库根目录直接下载 `custom-commands-0.1.0.vsix` 文件。
2. 打开 VSCode → 扩展面板 → 右上角「···」→ **Install from VSIX...** → 选择下载的 `.vsix` 文件。
3. 或命令行安装：`code --install-extension custom-commands-0.1.0.vsix`
4. 重启 VSCode 后，点击左侧 activity bar 的图标即可打开面板。

### 方式二：从源码构建

```bash
git clone https://github.com/YouyangHan/Custom-Commands-Vsix-For-VsCode.git
cd Custom-Commands-Vsix-For-VsCode
npm install
npm run compile
```

然后在 VSCode 中打开该项目，按 `F5` 启动扩展调试（Extension Development Host）。

## 开发

```bash
npm install       # 安装依赖
npm run compile   # 构建（esbuild）
npm run watch     # 监听构建
npm test          # 单元测试（vitest）
npm run typecheck # 类型检查
```

## 打包

```bash
npm run package   # 生成 .vsix
```

## 目录结构

```
src/
  extension.ts            # 入口
  types.ts                # 数据模型类型
  store.ts                # 存储读写、导入导出、数据校验、树操作
  variableResolver.ts     # ${内置变量} 替换
  parameterResolver.ts    # {{参数}} 解析与选择流程
  terminal.ts             # 终端执行
  i18n.ts                 # 中英文文案
  panel/panelProvider.ts  # WebviewViewProvider、消息路由
  webview/                # 面板前端（打包注入）
```

## 关于

Made by HanYouyang · [hanyouyang1999@163.com](mailto:hanyouyang1999@163.com)
