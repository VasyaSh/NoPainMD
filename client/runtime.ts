import { limitNotice } from '../shared/limits.js';
import { capTreeNodes } from '../shared/tree-nodes.js';
import { prepareDocument } from './document.js';

import type * as MermaidModule from 'mermaid';
import { errorMessage, errorStatus, isAbortError } from '../shared/errors.js';
import type { Heading, IndexLimit, IndexResult, MarkdownDocument, NoPainMDViewer, Theme, TreeNode, ViewerConfig, ViewerDataSource, ViewerOptions } from './types.js';
import type { PreparedDocument } from './document.js';

interface TreeState { nodes: Map<string, TreeNode>; expanded: Set<string>; collapsed: Set<string> }
interface OpenDocument extends MarkdownDocument { updateLinks: PreparedDocument['updateLinks'] }
interface ViewState extends TreeState {
  config: ViewerConfig;
  filtered: TreeState & { query: string };
  document: OpenDocument | null;
  selected: string | null;
  request: number;
  render: number;
  controller: AbortController | null;
  warnings: string[];
  limits: IndexLimit[];
  busy: boolean;
  indexed: boolean;
  htmlPreference?: boolean;
  htmlEnabled: boolean;
}
interface ScrollPosition { contentTop: number; contentLeft: number; treeTop: number; treeLeft: number }

let mermaidModule: Promise<typeof MermaidModule> | undefined;
let diagramQueue = Promise.resolve();
let mermaidDefaults: Record<string, unknown> | undefined;
let instanceCount = 0;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function startViewer(root: HTMLElement, dom: HTMLElement | ShadowRoot, options: ViewerOptions, source: ViewerDataSource, print: () => void): NoPainMDViewer {
  const lifetime = new AbortController();
  const instance = ++instanceCount;
  let destroyed = false;
  let selectedFile = options.file ?? null;
  let selectedHash = options.hash ?? '';
  const storageKey = options.storageKey ?? 'nopainmd';
  const currentFile = () => options.history ? new URL(location.href).searchParams.get('file') : selectedFile;
  const currentHash = () => options.history ? location.hash : selectedHash;
  function title(value: string) { if (options.updateTitle) document.title = value; }
  function warn(error: unknown) {
    if (destroyed || isAbortError(error)) return;
    state.warnings.push(errorMessage(error)); notices();
    options.onError?.(error instanceof Error ? error : new Error(errorMessage(error)));
  }
  function run(task: Promise<void>) { void task.catch(warn); }
  function $<T extends HTMLElement>(selector: string): T {
    const element = dom.querySelector<T>(selector);
    if (!element) throw new Error(`Missing viewer element: ${selector}`);
    return element;
  }
  const ui = { tree: $('#tree'), treeScroll: $('#tree-scroll'), panel: $('#document-panel'), content: $('#content'), reload: $<HTMLButtonElement>('#reload'), search: $<HTMLInputElement>('#quick-search'), print: $<HTMLButtonElement>('#print'), theme: $<HTMLButtonElement>('#theme'), html: $<HTMLButtonElement>('#html-toggle'), divider: $('#divider'), notices: $('#notices') };
  const state: ViewState = { config: { root: '', separator: '/', font: 'Open Sans', fontZoom: 100, maxNodes: 1000, htmlEnabled: true, warnings: [] }, nodes: new Map(), expanded: new Set(), collapsed: new Set(), filtered: { query: '', nodes: new Map(), expanded: new Set(), collapsed: new Set() }, document: null, selected: null, request: 0, render: 0, controller: null, warnings: [], limits: [], busy: false, indexed: false, htmlEnabled: true };
  if (options.history && options.file !== undefined) {
    const url = new URL(location.href);
    if (options.file === null) url.searchParams.delete('file'); else url.searchParams.set('file', options.file);
    url.hash = options.hash ?? '';
    history.replaceState(null, '', url);
  }
  try { const saved = storageKey === false ? null : localStorage.getItem(`${storageKey}.html`); if (saved === 'true' || saved === 'false') state.htmlPreference = saved === 'true'; } catch {}
  if (options.htmlEnabled !== undefined) state.htmlPreference = options.htmlEnabled;
  try { root.dataset.theme = options.theme ?? (storageKey && localStorage.getItem(`${storageKey}.theme`) === 'dark' ? 'dark' : 'light'); } catch { root.dataset.theme = options.theme ?? 'light'; }
  try {
    const saved = Number(storageKey && localStorage.getItem(`${storageKey}.sidebarWidth`));
    if (Number.isFinite(saved) && saved > 0) width(saved, false);
  } catch {}

  function diagramTypography(defaults: Record<string, unknown>, size: number, family: string, baseSize: number): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(defaults)) {
      if (/fontFamily$/iu.test(key)) output[key] = family;
      else if (/(fontSize|textSize)$/iu.test(key) && Number.isFinite(parseFloat(String(value)))) {
        const scaled = parseFloat(String(value)) / baseSize * size;
        output[key] = typeof value === 'number' ? scaled : `${scaled}px`;
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const children = diagramTypography(object(value), size, family, baseSize);
        if (Object.keys(children).length) output[key] = children;
      }
    }
    return output;
  }

  function save(key: string, value: string | number | boolean) { try { if (storageKey !== false) localStorage.setItem(`${storageKey}.${key}`, String(value)); } catch {} }
  function basename(file: string) { return file.split(/[\\/]/u).at(-1) ?? file; }
  function fileURL(file: string, hash = '') {
    const url = new URL(location.href);
    url.searchParams.set('file', file); url.hash = hash;
    return `${url.pathname}?${url.searchParams.toString().replaceAll('%2F', '/').replaceAll('%3A', ':')}${url.hash}`;
  }
  function inside(root: string, file: string) { return file === root || file.startsWith(root.endsWith(state.config.separator) ? root : root + state.config.separator); }
  function parent(file: string) { const at = file.lastIndexOf(state.config.separator); return file.slice(0, at) || state.config.separator; }
  function snapshot() { return { contentTop: ui.panel.scrollTop, contentLeft: ui.panel.scrollLeft, treeTop: ui.treeScroll.scrollTop, treeLeft: ui.treeScroll.scrollLeft }; }
  function restore(scroll: ScrollPosition) { ui.panel.scrollTo(scroll.contentLeft, scroll.contentTop); ui.treeScroll.scrollTo(scroll.treeLeft, scroll.treeTop); }
  function configure(config: ViewerConfig) {
    state.config = config;
    state.htmlEnabled = state.htmlPreference ?? config.htmlEnabled;
    htmlState();
    $('#base-path').textContent = config.root;
    $('#base-path').title = config.root;
    root.style.setProperty('--font', `${JSON.stringify(config.font)}, "Open Sans", sans-serif`);
    root.style.fontSize = `${config.fontZoom}%`;
  }
  function htmlState() {
    ui.html.setAttribute('aria-checked', String(state.htmlEnabled));
    ui.html.title = `${state.htmlEnabled ? 'Disable' : 'Enable'} HTML rendering`;
  }
  async function setHTMLEnabled(enabled: boolean): Promise<void> {
    if (destroyed) return;
    state.htmlPreference = enabled;
    state.htmlEnabled = state.htmlPreference;
    save('html', state.htmlPreference);
    htmlState();
    if (state.busy) await load({ refresh: true });
    else await applyHTML();
  }
  ui.html.addEventListener('click', () => { run(setHTMLEnabled(!state.htmlEnabled)); }, { signal: lifetime.signal });
  function displayDocument(doc: MarkdownDocument): OpenDocument {
    const variant = doc.htmlEnabled === state.htmlEnabled ? doc : doc.alternate;
    const rendered = prepareDocument({ ...doc, ...(variant || doc) }, { fileURL, imageURL: source.imageURL?.bind(source) });
    rendered.updateLinks(state.nodes);
    ui.content.classList.remove('empty'); ui.content.replaceChildren(rendered.fragment);
    title(rendered.title);
    return { ...doc, headings: rendered.headings, title: rendered.title, updateLinks: rendered.updateLinks };
  }
  async function applyHTML() {
    const doc = state.document;
    if (!doc) return;
    const scroll = snapshot();
    const id = ++state.request;
    ++state.render;
    ui.html.disabled = true;
    try {
      state.document = displayDocument(doc);
      options.onDocumentChange?.(state.document);
      drawTree(); restore(scroll);
      await renderDiagrams();
      if (id !== state.request) return;
      await settleImages();
      if (id === state.request) restore(scroll);
    } catch (error) {
      if (id === state.request) warn(error);
    } finally { if (id === state.request) ui.html.disabled = false; }
  }
  function themeState() {
    const dark = root.dataset.theme === 'dark';
    ui.theme.setAttribute('aria-checked', String(dark));
    ui.theme.title = `Switch to ${dark ? 'light' : 'dark'} theme`;
    $('#theme-label').textContent = dark ? 'Dark' : 'Light';
  }
  async function setTheme(value: Theme): Promise<void> {
    if (destroyed) return;
    const scroll = snapshot();
    const request = state.request;
    root.dataset.theme = value;
    save('theme', value);
    themeState();
    await renderDiagrams();
    if (request === state.request) restore(scroll);
  }
  ui.theme.addEventListener('click', () => { run(setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark')); }, { signal: lifetime.signal });
  themeState();

  function width(value: number, persist = true) {
    const next = Math.max(50, Math.min(1000, value));
    root.style.setProperty('--sidebar-width', `${next}px`);
    ui.divider.setAttribute('aria-valuenow', String(Math.round(next)));
    if (persist) save('sidebarWidth', next);
  }
  ui.divider.setAttribute('aria-valuenow', String(parseFloat(getComputedStyle(root).getPropertyValue('--sidebar-width')) || 300));
  ui.divider.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    ui.divider.setPointerCapture(event.pointerId);
    root.classList.add('resizing');
  }, { signal: lifetime.signal });
  ui.divider.addEventListener('pointermove', event => { if (ui.divider.hasPointerCapture(event.pointerId)) width(event.clientX - root.getBoundingClientRect().left); }, { signal: lifetime.signal });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) ui.divider.addEventListener(type, event => {
    if (ui.divider.hasPointerCapture(event.pointerId)) ui.divider.releasePointerCapture(event.pointerId);
    root.classList.remove('resizing');
  }, { signal: lifetime.signal });
  ui.divider.addEventListener('keydown', event => {
    const current = parseFloat(getComputedStyle(root).getPropertyValue('--sidebar-width')) || 300;
    const targets: Record<string, number> = { ArrowLeft: current - 10, ArrowRight: current + 10, Home: 50, End: 1000 };
    const next = targets[event.key];
    if (next !== undefined) { event.preventDefault(); width(next); }
  }, { signal: lifetime.signal });

  function headingList(headings: Heading[]) {
    const root = document.createElement('ul');
    root.className = 'toc';
    const stack: { level: number; item: HTMLLIElement; list?: HTMLUListElement }[] = [];
    for (const heading of headings) {
      while (stack.length && (stack.at(-1)?.level ?? 0) >= heading.level) stack.pop();
      let list = root;
      const ancestor = stack.at(-1);
      if (ancestor) {
        if (!ancestor.list) { ancestor.list = document.createElement('ul'); ancestor.item.append(ancestor.list); }
        list = ancestor.list;
      }
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.textContent = heading.text;
      link.href = fileURL(state.document?.path ?? '', `#${encodeURIComponent(heading.id)}`);
      item.append(link); list.append(item);
      stack.push({ level: heading.level, item });
    }
    return root;
  }
  function activeTree() {
    const filtered = state.filtered;
    if (!filtered.query) return state;
    // Filtering keeps its own nodes and expansion state.
    filtered.nodes = new Map();
    for (const file of state.nodes.values()) {
      if (file.type !== 'file' || !file.name.toLowerCase().includes(filtered.query)) continue;
      if (file.external && file.path !== state.document?.path) continue;
      let node: TreeNode | undefined = file;
      while (node && !filtered.nodes.has(node.path)) {
        filtered.nodes.set(node.path, { ...node });
        if (node.type === 'directory' && !filtered.collapsed.has(node.path)) filtered.expanded.add(node.path);
        node = state.nodes.get(node.parent);
      }
    }
    return filtered;
  }
  ui.search.addEventListener('input', () => {
    const query = ui.search.value.toLowerCase();
    if (query === state.filtered.query) return;
    state.filtered.query = query;
    state.filtered.nodes.clear(); state.filtered.expanded.clear(); state.filtered.collapsed.clear();
    drawTree();
    ui.treeScroll.scrollTo(0, 0);
  }, { signal: lifetime.signal });
  function drawTree() {
    if (!state.config.root) return;
    state.document?.updateLinks(state.nodes);
    const tree = activeTree();
    const top = ui.treeScroll.scrollTop;
    const left = ui.treeScroll.scrollLeft;
    const groups = new Map<string, TreeNode[]>();
    for (const node of tree.nodes.values()) {
      if (node.external && node.path !== state.document?.path) continue;
      if (!groups.has(node.parent)) groups.set(node.parent, []);
      groups.get(node.parent)?.push(node);
    }
    function branch(parentPath: string): HTMLUListElement {
      const list = document.createElement('ul'); list.className = 'files';
      const nodes = (groups.get(parentPath) || []).sort((a, b) => Number(Boolean(b.external)) - Number(Boolean(a.external)) || a.name.localeCompare(b.name, undefined, { numeric: true }));
      // Auto-expand only after indexing finishes.
      const only = nodes.length === 1 ? nodes[0] : undefined;
      if (!state.busy && only?.type === 'directory' && !tree.collapsed.has(only.path)) tree.expanded.add(only.path);
      for (const node of nodes) {
        const item = document.createElement('li');
        if (node.type === 'directory') {
          const toggle = document.createElement('button');
          toggle.className = 'folder-row'; toggle.title = node.path;
          toggle.setAttribute('aria-expanded', String(tree.expanded.has(node.path)));
          // Highlight the deepest visible collapsed ancestor.
          if (state.document && !tree.expanded.has(node.path) && inside(node.path, state.document.path)) {
            toggle.classList.add('selected'); toggle.setAttribute('aria-current', 'location');
          }
          toggle.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m4 2 4 4-4 4"/></svg>';
          toggle.append(document.createTextNode(node.name));
          toggle.addEventListener('click', () => {
            if (destroyed) return;
            if (tree.expanded.has(node.path)) { tree.expanded.delete(node.path); tree.collapsed.add(node.path); }
            else { tree.expanded.add(node.path); tree.collapsed.delete(node.path); }
            drawTree();
            [...ui.tree.querySelectorAll<HTMLButtonElement>('.folder-row')].find(button => button.title === node.path)?.focus({ preventScroll: true });
          });
          item.append(toggle);
          if (tree.expanded.has(node.path)) item.append(branch(node.path));
        } else {
          const link = document.createElement('a');
          link.className = 'file-row'; link.href = fileURL(node.path); link.title = node.path;
          link.textContent = `${node.external ? '/**/' : ''}${node.name}`;
          if (node.path === state.document?.path) { link.classList.add('selected'); link.setAttribute('aria-current', 'page'); }
          item.append(link);
          if (node.path === state.document?.path && state.document.headings.length) item.append(headingList(state.document.headings));
        }
        list.append(item);
      }
      return list;
    }
    ui.tree.replaceChildren(branch(state.config.root));
    if (!tree.nodes.size && !state.busy) ui.tree.textContent = state.filtered.query ? 'No matching Markdown files.' : 'No Markdown files found.';
    ui.treeScroll.scrollTo(left, top);
  }
  function selectionNodes(reveal: boolean) {
    for (const [file, node] of state.nodes) if (node.external) state.nodes.delete(file);
    const doc = state.document;
    const priority = new Map<string, TreeNode>();
    if (doc && !doc.external) {
      const ancestors: TreeNode[] = [];
      let dir = doc.parent;
      while (dir !== state.config.root && inside(state.config.root, dir)) {
        ancestors.unshift({ path: dir, name: basename(dir), type: 'directory', parent: parent(dir) });
        if (reveal) {
          state.expanded.add(dir); state.collapsed.delete(dir);
          state.filtered.expanded.add(dir); state.filtered.collapsed.delete(dir);
        }
        dir = parent(dir);
      }
      for (const node of ancestors) priority.set(node.path, node);
    }
    if (doc) priority.set(doc.path, { path: doc.path, name: doc.name, parent: doc.parent, type: 'file', external: doc.external });
    const all = [...priority.values(), ...[...state.nodes.values()].sort((a, b) => a.path.length - b.path.length)];
    const capped = capTreeNodes(all, state.config.root, state.config.maxNodes);
    if (capped.limited && !state.limits.includes('nodes')) state.limits.push('nodes');
    state.nodes = capped.nodes;
  }
  function mergeIndex(result: IndexResult) {
    const candidates = [...result.nodes];
    if (result.limits.length || result.warnings.length) {
      // Keep unvisited branches when a partial scan leaves room.
      const old = [...state.nodes.values()].sort((a, b) => a.path.length - b.path.length);
      for (const node of old) {
        if (node.external) continue;
        if (result.completeDirectories.some(dir => inside(dir, node.path))) continue;
        candidates.push(node);
      }
    }
    const capped = capTreeNodes(candidates, state.config.root, result.maxNodes);
    state.nodes = capped.nodes;
    state.limits = [...new Set([...result.limits, ...(capped.limited ? ['nodes' as const] : [])])];
    state.warnings = [...new Set([...state.config.warnings, ...result.warnings])];
  }
  function notices() {
    ui.notices.replaceChildren();
    for (const limit of state.limits) {
      const p = document.createElement('p');
      p.textContent = limitNotice(limit);
      ui.notices.append(p);
    }
    for (const message of state.warnings) { const p = document.createElement('p'); p.textContent = message; ui.notices.append(p); }
  }
  function showError(message: string, file?: string) {
    ui.content.replaceChildren(); ui.content.classList.add('empty');
    const box = document.createElement('div'); box.append(document.createTextNode(message));
    if (file) { const name = document.createElement('span'); name.className = 'error-path'; name.textContent = file; box.append(document.createElement('br'), name); }
    ui.content.append(box);
  }

  async function renderDiagrams() {
    const revision = ++state.render;
    const blocks = [...ui.content.querySelectorAll<HTMLElement & { source?: string }>('.mermaid-block')];
    ui.print.disabled = true;
    if (!blocks.length) { ui.print.disabled = false; return; }
    for (const block of blocks) block.source ??= block.querySelector('.mermaid-source')?.textContent || '';
    const active = () => !destroyed && state.render === revision;
    const task = async () => {
      if (!active()) return;
      try {
        await document.fonts.ready;
        if (!active()) return;
        mermaidModule ??= import('mermaid');
        const { default: mermaid } = await mermaidModule;
        // Strip Mermaid helper functions from the saved config.
        mermaidDefaults ??= object(JSON.parse(JSON.stringify(mermaid.mermaidAPI.getConfig())) as unknown);
        const font = getComputedStyle(ui.content);
        const typography = diagramTypography(mermaidDefaults, parseFloat(font.fontSize), font.fontFamily, parseFloat(String(object(mermaidDefaults.themeVariables).fontSize)) || 16);
        const currentTheme = root.dataset.theme;
        for (let i = 0; i < blocks.length && active(); i++) {
          const block = blocks[i];
          if (!block) continue;
          const variants = [];
          try {
            for (const variant of ['screen', 'print']) {
              const dark = variant === 'screen' && currentTheme === 'dark';
              const text = dark ? '#dddddd' : '#222222';
              const fill = dark ? '#2a2a2a' : '#eeeeee';
              const line = dark ? '#a0a0a0' : '#707070';
              mermaid.initialize({
                ...typography,
                startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'base',
                fontFamily: getComputedStyle(ui.content).fontFamily,
                secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'theme', 'themeVariables', 'fontFamily'],
                themeVariables: { ...object(typography.themeVariables), darkMode: dark, background: dark ? '#111111' : '#fafafa', primaryColor: fill, secondaryColor: fill, tertiaryColor: fill, primaryTextColor: text, secondaryTextColor: text, tertiaryTextColor: text, textColor: text, titleColor: text, noteTextColor: text, noteBkgColor: fill, lineColor: line, primaryBorderColor: line, secondaryBorderColor: line, tertiaryBorderColor: line, fontFamily: font.fontFamily, fontSize: font.fontSize },
                flowchart: { ...object(typography.flowchart), useMaxWidth: false }, sequence: { ...object(typography.sequence), useMaxWidth: false },
              });
              const { svg } = await mermaid.render(`diagram-${instance}-${revision}-${i}-${variant}`, block.source ?? '');
              if (!active()) return;
              const wrapper = document.createElement('div'); wrapper.className = `mermaid-${variant}`; wrapper.innerHTML = svg;
              variants.push(wrapper);
            }
            block.replaceChildren(...variants);
          } catch (error) {
            if (!active()) return;
            const message = document.createElement('p'); message.className = 'mermaid-error'; message.textContent = `Could not render Mermaid diagram: ${errorMessage(error).split('\n')[0]}`;
            const source = document.createElement('pre'); source.textContent = block.source ?? '';
            block.replaceChildren(message, source);
          }
        }
      } catch (error) {
        if (active()) for (const block of blocks) {
          const message = document.createElement('p'); message.className = 'mermaid-error'; message.textContent = `Mermaid is unavailable: ${errorMessage(error).split('\n')[0]}`;
          block.prepend(message);
        }
      } finally { if (active()) ui.print.disabled = false; }
    };
    diagramQueue = diagramQueue.then(task, task);
    await diagramQueue;
  }
  async function settleImages() {
    await Promise.all([...ui.content.querySelectorAll('img')].map(img => Promise.race([
      img.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500)),
    ])));
  }
  function scrollHeading() {
    let id;
    try { id = decodeURIComponent(currentHash().replace(/^#/u, '')); } catch { return; }
    const target = id && [...ui.content.querySelectorAll('[id]')].find(node => node.id === id);
    if (target) target.scrollIntoView({ block: 'start' });
    else ui.panel.scrollTo(0, 0);
  }

  async function load({ refresh = false, index = false, initial = false } = {}): Promise<void> {
    if (destroyed) return;
    const scroll = snapshot();
    state.controller?.abort();
    state.controller = new AbortController();
    const id = ++state.request;
    ++state.render;
    state.busy = true;
    ui.html.disabled = true;
    ui.reload.disabled = true; ui.reload.classList.add('busy'); ui.reload.setAttribute('aria-busy', 'true');
    try {
      const config = await source.getConfig(state.controller.signal);
      if (id !== state.request) return;
      configure(config);
      state.warnings = [...state.config.warnings];
      const file = currentFile();
      state.selected = file;
      state.document = null;
      if (file) {
        try {
          const doc = await source.getDocument(file, { htmlEnabled: state.htmlEnabled, signal: state.controller.signal });
          if (id !== state.request) return;
          state.document = displayDocument(doc);
        } catch (error) {
          if (isAbortError(error)) throw error;
          if (id !== state.request) return;
          showError(errorStatus(error) === 404 ? 'File not found' : errorMessage(error), file);
          title(basename(file));
          // Remove missing selections even after a partial scan.
          state.nodes.delete(file);
        }
      } else { showError('Select a Markdown file'); title('NoPainMD'); }
      options.onDocumentChange?.(state.document);
      ui.print.hidden = !state.document;
      selectionNodes(!refresh);
      drawTree();
      await renderDiagrams();
      if (id !== state.request) return;
      if (index || refresh || initial || !state.indexed) {
        const result = await source.index(state.document?.path ?? null, state.controller.signal);
        if (id !== state.request) return;
        state.indexed = true;
        mergeIndex(result); drawTree();
      }
      await settleImages();
      if (id !== state.request) return;
      if (refresh) restore(scroll); else scrollHeading();
      notices();
    } catch (error) {
      if (id === state.request) warn(error);
    } finally {
      if (id === state.request) {
        state.busy = false; ui.html.disabled = false; ui.reload.disabled = false; ui.reload.classList.remove('busy'); ui.reload.removeAttribute('aria-busy'); drawTree();
      }
    }
  }
  ui.reload.addEventListener('click', () => { run(load({ refresh: true })); }, { signal: lifetime.signal });
  ui.print.addEventListener('click', () => { if (!ui.print.disabled) print(); }, { signal: lifetime.signal });
  async function navigate(file: string, hash = ''): Promise<void> {
    if (destroyed) return;
    const same = file === state.document?.path;
    selectedFile = file; selectedHash = hash;
    if (options.history) history.pushState(null, '', fileURL(file, hash));
    options.onNavigate?.(file, hash);
    if (same) { selectionNodes(true); drawTree(); scrollHeading(); }
    else await load();
  }
  dom.addEventListener('click', event => {
    if (!(event instanceof MouseEvent) || !(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('a[href]');
    if (!link || link.target === '_blank' || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    if (link.getAttribute('href')?.startsWith('#') && state.document) {
      event.preventDefault(); run(navigate(state.document.path, url.hash)); return;
    }
    const file = url.searchParams.get('file');
    if (url.pathname !== location.pathname || file === null) return;
    event.preventDefault(); run(navigate(file, url.hash));
  }, { signal: lifetime.signal });
  if (options.history) window.addEventListener('popstate', () => {
    if (currentFile() === state.document?.path) scrollHeading(); else run(load());
  }, { signal: lifetime.signal });
  const ready = load({ initial: true });
  return {
    element: root, ready, open: navigate, reload: () => load({ refresh: true }), setTheme, setHTMLEnabled,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ++state.request; ++state.render;
      state.controller?.abort(); lifetime.abort();
      state.nodes.clear(); state.filtered.nodes.clear(); state.document = null;
      root.classList.remove('resizing');
    },
  };
}
