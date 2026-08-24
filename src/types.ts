/**
 * 数据模型类型定义（纯类型，无任何运行时依赖）。
 */

/** 参数化命令的参数（选择项） */
export interface CommandParameter {
  /** 占位符名，命令中用 {{name}} 引用 */
  name: string;
  /** 选择时的显示标签 */
  label: string;
  /** options：固定选项；directory：目录枚举 */
  type: 'options' | 'directory';
  /** type = 'options'：固定选项列表 */
  options: string[];
  /** type = 'directory'：目录路径（支持 ${workspaceFolder} 等内置变量） */
  directoryPath: string;
  /** type = 'directory'：选项值是否包含全路径（默认 false，仅目录名） */
  fullPath?: boolean;
  /** 默认选项值 */
  default?: string;
}

/** 一条命令 */
export interface CommandItem {
  id: string;
  /** 显示名 */
  name: string;
  /** 终端命令，可含 ${内置变量} 和 {{参数名}} */
  command: string;
  /** 描述 */
  description: string;
  /** 参数列表（可为空） */
  parameters: CommandParameter[];
  /** 是否执行（默认 true：输入并回车执行；false：仅输入到终端） */
  execute?: boolean;
}

/** 分组节点（多级嵌套） */
export interface GroupNode {
  id: string;
  name: string;
  commands: CommandItem[];
  groups: GroupNode[];
  /** 折叠状态，持久化 */
  collapsed: boolean;
}

/** 顶层结构：一组分组列表 */
export type CommandStore = GroupNode[];

/** 参数上次选择：{ [commandId]: { [parameterName]: value } } */
export type LastSelections = {
  [commandId: string]: { [parameterName: string]: string };
};

/** 界面语言 */
export type Language = 'zh' | 'en';
