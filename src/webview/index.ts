/**
 * 面板前端（打包为 dist/webview.js 注入）。纯 HTML/CSS/TS，不引入框架。
 * 扩展端是数据唯一来源：前端发送变更消息，扩展应用并回传最新 store。
 * UI 文案通过共享 i18n 模块按当前语言渲染。
 */
import './style.css';
import { t, type MessageKey } from '../i18n';
import type { Language } from '../types';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

interface CommandParameter {
  name: string;
  label: string;
  type: 'options' | 'directory';
  options: string[];
  directoryPath: string;
  fullPath?: boolean;
  default?: string;
}
interface CommandItem {
  id: string;
  name: string;
  command: string;
  description: string;
  parameters: CommandParameter[];
  execute?: boolean;
}
interface GroupNode {
  id: string;
  name: string;
  commands: CommandItem[];
  groups: GroupNode[];
  collapsed: boolean;
}
type CommandStore = GroupNode[];

interface ParameterOption {
  label: string;
  value: string;
}

const vscode = acquireVsCodeApi();

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const runTab = $('tab-run') as HTMLButtonElement;
const configTab = $('tab-config') as HTMLButtonElement;
const settingsTab = $('tab-settings') as HTMLButtonElement;
const toolbarEl = $('toolbar');
const addRootGroupBtn = $('add-root-group') as HTMLButtonElement;
const importBtn = $('import-btn') as HTMLButtonElement;
const exportBtn = $('export-btn') as HTMLButtonElement;
const treeEl = $('tree');
const editorEl = $('editor');
const settingsEl = $('settings');
const statusEl = $('status');

let store: CommandStore = [];
let activeTab: 'run' | 'config' | 'settings' = 'run';
let editing: { command: CommandItem; groupId: string } | null = null;
let lang: Language = 'zh';
let statusTimer: number | undefined;
let lastSelections: Record<string, Record<string, string>> = {};
let dirOptions: Record<string, Record<string, ParameterOption[]>> = {};
const pendingDir = new Set<string>();
let lastDirSig = '';

const T = (key: MessageKey): string => t(lang, key);

// ---------- SVG 图标 ----------

function svg(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

const ICONS: Record<string, string> = {
  play: svg('<polygon points="5 3 19 12 5 21 5 3"/>'),
  plus: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  folderPlus: svg(
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>'
  ),
  edit: svg('<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>'),
  rename: svg('<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>'),
  trash: svg(
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'
  ),
  up: svg('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'),
  down: svg('<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>'),
  refresh: svg(
    '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'
  ),
};

function post(msg: unknown): void {
  vscode.postMessage(msg);
}

function createEl(tag: string, className?: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function button(
  label: string,
  className: string,
  onClick: () => void,
  title?: string
): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  b.textContent = label;
  if (title) b.title = title;
  b.onclick = onClick;
  return b;
}

function iconButton(name: string, title: string, onClick: () => void, danger = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'icon-btn' + (danger ? ' danger' : '');
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = ICONS[name] ?? '';
  b.onclick = onClick;
  return b;
}

function bindInput(
  input: HTMLInputElement | HTMLTextAreaElement,
  get: () => string,
  set: (v: string) => void
): void {
  input.value = get();
  input.addEventListener('input', () => set(input.value));
}

function field(label: string, build: () => HTMLElement): HTMLElement {
  const wrap = createEl('div', 'field');
  wrap.appendChild(createEl('label', 'field-label', label));
  wrap.appendChild(build());
  return wrap;
}

function checkboxField(
  label: string,
  hint: string | undefined,
  get: () => boolean,
  set: (v: boolean) => void
): HTMLElement {
  const wrap = createEl('div', 'field checkbox-field');
  const lbl = document.createElement('label');
  lbl.className = 'checkbox-label';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = get();
  input.addEventListener('change', () => set(input.checked));
  lbl.appendChild(input);
  lbl.appendChild(createEl('span', undefined, label));
  wrap.appendChild(lbl);
  if (hint) wrap.appendChild(createEl('div', 'field-hint', hint));
  return wrap;
}

// ---------- 渲染 ----------

function render(): void {
  renderTabs();
  const isSettings = activeTab === 'settings';
  toolbarEl.style.display = activeTab === 'config' ? 'flex' : 'none';
  treeEl.style.display = isSettings ? 'none' : 'block';
  editorEl.style.display = isSettings ? 'none' : 'block';
  settingsEl.style.display = isSettings ? 'block' : 'none';
  if (isSettings) {
    renderSettings();
  } else {
    renderTree();
    renderEditor();
  }
}

function renderTabs(): void {
  runTab.classList.toggle('active', activeTab === 'run');
  configTab.classList.toggle('active', activeTab === 'config');
  settingsTab.classList.toggle('active', activeTab === 'settings');
  runTab.textContent = T('tab.run');
  configTab.textContent = T('tab.config');
  settingsTab.textContent = T('tab.settings');

  addRootGroupBtn.innerHTML = ICONS.folderPlus;
  addRootGroupBtn.className = 'toolbar-btn icon-only';
  addRootGroupBtn.title = T('toolbar.addGroup');
  addRootGroupBtn.setAttribute('aria-label', T('toolbar.addGroup'));
  importBtn.textContent = 'Import';
  exportBtn.textContent = 'Export';
}

function renderTree(): void {
  treeEl.innerHTML = '';
  if (store.length === 0) {
    const empty = createEl('div', 'empty', activeTab === 'config' ? T('empty.config') : T('empty.run'));
    treeEl.appendChild(empty);
    return;
  }
  store.forEach((group) => treeEl.appendChild(renderGroup(group)));
}

function renderGroup(group: GroupNode): HTMLElement {
  const box = createEl('div', 'group');
  const header = createEl('div', 'group-header');

  const toggle = createEl(
    'span',
    'toggle' + (group.collapsed ? ' collapsed' : ''),
    group.collapsed ? '▸' : '▾'
  );
  toggle.onclick = () => post({ type: 'toggleCollapse', id: group.id, collapsed: !group.collapsed });
  header.appendChild(toggle);
  header.appendChild(createEl('span', 'group-name', group.name));

  if (activeTab === 'config') {
    header.appendChild(iconButton('plus', T('action.addCommand'), () => post({ type: 'addCommand', groupId: group.id })));
    header.appendChild(iconButton('folderPlus', T('action.addSubGroup'), () => post({ type: 'addGroup', parentId: group.id })));
    header.appendChild(iconButton('rename', T('action.rename'), () => post({ type: 'renameGroup', id: group.id })));
    header.appendChild(iconButton('up', T('action.moveUp'), () => post({ type: 'moveGroup', id: group.id, direction: 'up' })));
    header.appendChild(iconButton('down', T('action.moveDown'), () => post({ type: 'moveGroup', id: group.id, direction: 'down' })));
    header.appendChild(iconButton('trash', T('action.delete'), () => post({ type: 'deleteGroup', id: group.id }), true));
  }

  box.appendChild(header);

  if (!group.collapsed) {
    group.groups.forEach((g) => box.appendChild(renderGroup(g)));
    group.commands.forEach((c) => box.appendChild(renderCommand(c, group.id)));
  }
  return box;
}

function renderCommand(cmd: CommandItem, groupId: string): HTMLElement {
  const node = createEl('div', 'command-node');
  const row = createEl('div', 'command');
  if (cmd.description) row.title = cmd.description;
  const name = createEl('span', 'command-name', cmd.name);

  if (activeTab === 'run') {
    name.onclick = () => run(cmd);
    row.appendChild(name);
    row.appendChild(iconButton('play', T('action.run'), () => run(cmd)));
  } else {
    row.appendChild(name);
    row.appendChild(iconButton('edit', T('action.edit'), () => openEditor(cmd, groupId)));
    row.appendChild(iconButton('rename', T('action.rename'), () => post({ type: 'renameCommand', id: cmd.id })));
    row.appendChild(iconButton('up', T('action.moveUp'), () => post({ type: 'moveCommand', id: cmd.id, direction: 'up' })));
    row.appendChild(iconButton('down', T('action.moveDown'), () => post({ type: 'moveCommand', id: cmd.id, direction: 'down' })));
    row.appendChild(iconButton('trash', T('action.delete'), () => post({ type: 'deleteCommand', id: cmd.id }), true));
  }
  node.appendChild(row);
  if (activeTab === 'run' && cmd.parameters.length > 0) {
    node.appendChild(renderRunParams(cmd));
  }
  return node;
}

function renderRunParams(cmd: CommandItem): HTMLElement {
  const wrap = createEl('div', 'run-params');
  wrap.setAttribute('data-cmd', cmd.id);
  cmd.parameters.forEach((param) => wrap.appendChild(renderRunParamRow(cmd, param)));
  return wrap;
}

function renderRunParamRow(cmd: CommandItem, param: CommandParameter): HTMLElement {
  const row = createEl('div', 'run-param');
  row.appendChild(createEl('span', 'run-param-label', param.label || param.name));

  const options = getParamOptions(cmd, param);
  const preferred = lastSelections[cmd.id]?.[param.name] ?? param.default ?? '';
  const current =
    preferred && options.some((o) => o.value === preferred)
      ? preferred
      : (options[0]?.value ?? '');

  const select = document.createElement('select');
  select.className = 'run-param-select';
  select.setAttribute('data-param', param.name);
  options.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    select.appendChild(opt);
  });
  select.value = current;
  select.onchange = () => setSelection(cmd.id, param.name, select.value);
  row.appendChild(select);

  if (param.type === 'directory') {
    row.appendChild(iconButton('refresh', T('action.refresh'), () => requestDirectoryOptions(cmd.id, param.name)));
  }
  return row;
}

function getParamOptions(cmd: CommandItem, param: CommandParameter): ParameterOption[] {
  if (param.type === 'options') {
    return param.options.map((o) => ({ label: o, value: o }));
  }
  const key = cmd.id + ':' + param.name;
  const cached = dirOptions[cmd.id]?.[param.name];
  if (!cached && !pendingDir.has(key)) {
    pendingDir.add(key);
    post({ type: 'getDirectoryOptions', commandId: cmd.id, parameterName: param.name });
  }
  return cached ?? [];
}

function computeDirSignature(): string {
  const parts: string[] = [];
  const walk = (groups: GroupNode[]): void => {
    for (const g of groups) {
      for (const c of g.commands) {
        for (const p of c.parameters) {
          if (p.type === 'directory') {
            parts.push(`${c.id}:${p.name}:${p.directoryPath}:${p.fullPath === true}`);
          }
        }
      }
      walk(g.groups);
    }
  };
  walk(store);
  return parts.join('|');
}

function setSelection(commandId: string, paramName: string, value: string): void {
  if (!lastSelections[commandId]) lastSelections[commandId] = {};
  lastSelections[commandId][paramName] = value;
  post({ type: 'setSelections', commandId, paramName, value });
}

function requestDirectoryOptions(commandId: string, paramName: string): void {
  const key = commandId + ':' + paramName;
  pendingDir.add(key);
  post({ type: 'getDirectoryOptions', commandId, parameterName: paramName });
}

function run(cmd: CommandItem): void {
  const selections: Record<string, string> = {};
  const container = document.querySelector(`[data-cmd="${cmd.id}"]`);
  if (container) {
    container.querySelectorAll('select.run-param-select').forEach((sel) => {
      const p = (sel as HTMLSelectElement).getAttribute('data-param');
      if (p) selections[p] = (sel as HTMLSelectElement).value;
    });
  }
  post({ type: 'runCommand', id: cmd.id, selections });
}

// ---------- 编辑器表单 ----------

function openEditor(cmd: CommandItem, groupId: string): void {
  editing = { command: JSON.parse(JSON.stringify(cmd)), groupId };
  render();
}

function renderEditor(): void {
  editorEl.innerHTML = '';
  if (!editing) return;

  const form = createEl('div', 'editor-form');
  form.appendChild(createEl('h3', 'editor-title', T('editor.title')));

  form.appendChild(
    field(T('field.name'), () => {
      const input = document.createElement('input');
      bindInput(input, () => editing!.command.name, (v) => (editing!.command.name = v));
      return input;
    })
  );
  form.appendChild(
    field(T('field.description'), () => {
      const input = document.createElement('input');
      bindInput(input, () => editing!.command.description, (v) => (editing!.command.description = v));
      return input;
    })
  );
  form.appendChild(
    field(T('field.command'), () => {
      const box = document.createElement('div');
      box.className = 'cmd-row';
      const ta = document.createElement('textarea');
      ta.rows = 3;
      bindInput(ta, () => editing!.command.command, (v) => (editing!.command.command = v));
      box.appendChild(ta);
      box.appendChild(iconButton('refresh', T('action.refresh.tip'), () => refreshParams()));
      return box;
    })
  );

  form.appendChild(
    checkboxField(
      T('field.execute'),
      T('field.executeHint'),
      () => editing!.command.execute !== false,
      (v) => (editing!.command.execute = v)
    )
  );

  form.appendChild(createEl('div', 'params-label', T('params.label')));
  const paramsContainer = createEl('div', 'params');
  paramsContainer.id = 'params-container';
  form.appendChild(paramsContainer);

  const actions = createEl('div', 'editor-actions');
  actions.appendChild(button(T('action.save'), 'primary', () => save()));
  actions.appendChild(
    button(T('action.cancel'), 'secondary', () => {
      editing = null;
      render();
    })
  );
  form.appendChild(actions);

  editorEl.appendChild(form);
  renderParams();
}

function renderParams(): void {
  const container = document.getElementById('params-container');
  if (!container || !editing) return;
  container.innerHTML = '';
  if (editing.command.parameters.length === 0) {
    container.appendChild(createEl('div', 'params-empty', T('params.empty')));
    return;
  }
  editing.command.parameters.forEach((param, i) => container.appendChild(renderParamCard(param, i)));
}

function renderParamCard(param: CommandParameter, index: number): HTMLElement {
  const card = createEl('div', 'param-card');
  card.appendChild(createEl('div', 'param-title', `{{${param.name}}}`));

  card.appendChild(
    field(T('field.name'), () => {
      const input = document.createElement('input');
      bindInput(input, () => editing!.command.parameters[index].name, (v) => (editing!.command.parameters[index].name = v));
      return input;
    })
  );
  card.appendChild(
    field(T('field.label'), () => {
      const input = document.createElement('input');
      bindInput(input, () => editing!.command.parameters[index].label, (v) => (editing!.command.parameters[index].label = v));
      return input;
    })
  );
  card.appendChild(
    field(T('field.type'), () => {
      const sel = document.createElement('select');
      ['options', 'directory'].forEach((ty) => {
        const opt = document.createElement('option');
        opt.value = ty;
        opt.textContent = ty === 'options' ? T('type.options') : T('type.directory');
        sel.appendChild(opt);
      });
      sel.value = editing!.command.parameters[index].type;
      sel.onchange = () => {
        editing!.command.parameters[index].type = sel.value as 'options' | 'directory';
        renderParams();
      };
      return sel;
    })
  );
  card.appendChild(
    field(T('field.default'), () => {
      const input = document.createElement('input');
      bindInput(input, () => editing!.command.parameters[index].default ?? '', (v) => (editing!.command.parameters[index].default = v));
      return input;
    })
  );

  if (param.type === 'options') {
    const optsWrap = createEl('div', 'options-wrap');
    param.options.forEach((opt, oi) => {
      const row = createEl('div', 'option-row');
      const input = document.createElement('input');
      input.value = opt;
      input.placeholder = T('option.placeholder');
      input.addEventListener('input', () => (editing!.command.parameters[index].options[oi] = input.value));
      row.appendChild(input);
      row.appendChild(
        iconButton('trash', T('action.deleteOption'), () => {
          editing!.command.parameters[index].options.splice(oi, 1);
          renderParams();
        }, true)
      );
      optsWrap.appendChild(row);
    });
    optsWrap.appendChild(
      button(T('action.addOption'), 'mini', () => {
        editing!.command.parameters[index].options.push('');
        renderParams();
      })
    );
    card.appendChild(optsWrap);
  } else {
    card.appendChild(
      field(T('field.directoryPath'), () => {
        const input = document.createElement('input');
        input.placeholder = T('directoryPath.placeholder');
        bindInput(input, () => editing!.command.parameters[index].directoryPath, (v) => (editing!.command.parameters[index].directoryPath = v));
        return input;
      })
    );
    card.appendChild(
      checkboxField(
        T('field.fullPath'),
        undefined,
        () => editing!.command.parameters[index].fullPath === true,
        (v) => (editing!.command.parameters[index].fullPath = v)
      )
    );
  }

  card.appendChild(
    button(T('action.deleteParam'), 'mini danger', () => {
      editing!.command.parameters.splice(index, 1);
      renderParams();
    })
  );

  return card;
}

function extractNames(text: string): string[] {
  const names: string[] = [];
  const re = /\{\{([^{}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1].trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function refreshParams(): void {
  if (!editing) return;
  const names = extractNames(editing.command.command);
  const existing = editing.command.parameters;
  editing.command.parameters = names.map((n) => {
    const found = existing.find((p) => p.name === n);
    if (found) return found;
    return { name: n, label: n, type: 'options', options: [], directoryPath: '', default: undefined };
  });
  renderParams();
}

function save(): void {
  if (!editing) return;
  post({ type: 'saveCommand', command: editing.command, groupId: editing.groupId });
}

function findCommandLocal(id: string): { command: CommandItem; groupId: string } | undefined {
  const search = (groups: GroupNode[]): { command: CommandItem; groupId: string } | undefined => {
    for (const g of groups) {
      const c = g.commands.find((x) => x.id === id);
      if (c) return { command: c, groupId: g.id };
      const sub = search(g.groups);
      if (sub) return sub;
    }
    return undefined;
  };
  return search(store);
}

// ---------- 设置页 ----------

function renderSettings(): void {
  settingsEl.innerHTML = '';
  const panel = createEl('div', 'settings-panel');

  panel.appendChild(
    field(T('settings.language'), () => {
      const sel = document.createElement('select');
      [
        { value: 'zh', label: '中文' },
        { value: 'en', label: 'English' },
      ].forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        sel.appendChild(opt);
      });
      sel.value = lang;
      sel.onchange = () => {
        lang = sel.value as Language;
        post({ type: 'setLanguage', language: lang });
        render();
      };
      return sel;
    })
  );

  const about = createEl('div', 'about');
  about.appendChild(createEl('div', 'about-title', T('settings.about')));
  about.appendChild(createEl('div', 'about-madeby', T('about.madeBy')));
  const email = document.createElement('a');
  email.className = 'about-email';
  email.href = 'mailto:hanyouyang1999@163.com';
  email.textContent = 'hanyouyang1999@163.com';
  about.appendChild(email);
  panel.appendChild(about);

  settingsEl.appendChild(panel);
}

function showStatus(message: string, level: 'info' | 'error'): void {
  statusEl.textContent = message;
  statusEl.className = level;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = '';
  }, 4000);
}

// ---------- 事件绑定 ----------

runTab.onclick = () => {
  activeTab = 'run';
  render();
};
configTab.onclick = () => {
  activeTab = 'config';
  render();
};
settingsTab.onclick = () => {
  activeTab = 'settings';
  render();
};
addRootGroupBtn.onclick = () => post({ type: 'addGroup' });
importBtn.onclick = () => post({ type: 'import' });
exportBtn.onclick = () => post({ type: 'export' });

window.addEventListener('message', (event) => {
  const msg = event.data as { type: string; [key: string]: unknown };
  switch (msg.type) {
    case 'setStore': {
      store = msg.store as CommandStore;
      if (typeof msg.language === 'string') lang = msg.language as Language;
      lastSelections = (msg.lastSelections as Record<string, Record<string, string>>) ?? {};
      const sig = computeDirSignature();
      if (sig !== lastDirSig) {
        dirOptions = {};
        pendingDir.clear();
        lastDirSig = sig;
      }
      if (editing && activeTab === 'config') {
        renderTabs();
        renderTree();
      } else {
        render();
      }
      break;
    }
    case 'focusEdit': {
      const found = findCommandLocal(String(msg.id));
      if (found) {
        editing = { command: JSON.parse(JSON.stringify(found.command)), groupId: found.groupId };
        activeTab = 'config';
        render();
      }
      break;
    }
    case 'saveResult':
      if (msg.ok) {
        editing = null;
        render();
        showStatus(T('status.saved'), 'info');
      } else {
        showStatus(String(msg.error), 'error');
      }
      break;
    case 'directoryOptions': {
      const commandId = String(msg.commandId);
      const parameterName = String(msg.parameterName);
      pendingDir.delete(commandId + ':' + parameterName);
      if (!dirOptions[commandId]) dirOptions[commandId] = {};
      dirOptions[commandId][parameterName] = (msg.options as ParameterOption[]) ?? [];
      if (msg.error) showStatus(String(msg.error), 'error');
      if (activeTab === 'run') renderTree();
      break;
    }
    case 'status':
      showStatus(String(msg.message), msg.level as 'info' | 'error');
      break;
  }
});

// ---------- 初始化 ----------

render();
post({ type: 'ready' });
