import { limitNotice } from './limits.js';
import { capTreeNodes } from './tree-nodes.js';
import { prepareDocument } from './document.js';

const $ = selector => document.querySelector(selector);
const ui = { tree: $('#tree'), treeScroll: $('#tree-scroll'), panel: $('#document-panel'), content: $('#content'), reload: $('#reload'), search: $('#quick-search'), print: $('#print'), theme: $('#theme'), html: $('#html-toggle'), divider: $('#divider'), notices: $('#notices') };
const state = { config: null, nodes: new Map(), expanded: new Set(), collapsed: new Set(), filtered: { query: '', nodes: new Map(), expanded: new Set(), collapsed: new Set() }, document: null, selected: null, request: 0, render: 0, controller: null, warnings: [], limits: [], busy: false };
try { const saved = localStorage.getItem('nopainmd.html'); if (saved === 'true' || saved === 'false') state.htmlPreference = saved === 'true'; } catch {}
let mermaidModule;
let diagramQueue = Promise.resolve();
let mermaidDefaults;

function diagramTypography(defaults, size, family, baseSize) {
  const output = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (/fontFamily$/iu.test(key)) output[key] = family;
    else if (/(fontSize|textSize)$/iu.test(key) && Number.isFinite(parseFloat(value))) {
      const scaled = parseFloat(value) / baseSize * size;
      output[key] = typeof value === 'number' ? scaled : `${scaled}px`;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const children = diagramTypography(value, size, family, baseSize);
      if (Object.keys(children).length) output[key] = children;
    }
  }
  return output;
}

function save(key, value) { try { localStorage.setItem(key, String(value)); } catch {} }
function basename(file) { return file.split(/[\\/]/u).at(-1); }
function fileURL(file, hash = '') { return `/?file=${encodeURIComponent(file).replaceAll('%2F', '/').replaceAll('%3A', ':')}${hash}`; }
function inside(root, file) { return file === root || file.startsWith(root.endsWith(state.config.separator) ? root : root + state.config.separator); }
function parent(file) { const at = file.lastIndexOf(state.config.separator); return file.slice(0, at) || state.config.separator; }
function snapshot() { return { contentTop: ui.panel.scrollTop, contentLeft: ui.panel.scrollLeft, treeTop: ui.treeScroll.scrollTop, treeLeft: ui.treeScroll.scrollLeft }; }
function restore(scroll) { ui.panel.scrollTo(scroll.contentLeft, scroll.contentTop); ui.treeScroll.scrollTo(scroll.treeLeft, scroll.treeTop); }
async function api(route, params = {}, signal = state.controller?.signal) {
  const response = await fetch(`${route}?${new URLSearchParams(params)}`, { signal });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: response.status });
  return data;
}
function configure(config) {
  state.config = config;
  state.htmlEnabled = state.htmlPreference ?? config.htmlEnabled;
  htmlState();
  $('#base-path').textContent = config.root;
  $('#base-path').title = config.root;
  document.documentElement.style.setProperty('--font', `${JSON.stringify(config.font)}, "Open Sans", sans-serif`);
  document.documentElement.style.fontSize = `${config.fontZoom}%`;
}
function htmlState() {
  ui.html.setAttribute('aria-checked', String(state.htmlEnabled));
  ui.html.title = `${state.htmlEnabled ? 'Disable' : 'Enable'} HTML rendering`;
}
ui.html.addEventListener('click', () => {
  state.htmlPreference = !state.htmlEnabled;
  state.htmlEnabled = state.htmlPreference;
  save('nopainmd.html', state.htmlPreference);
  htmlState();
  applyHTML();
});
function displayDocument(doc) {
  const variant = doc.htmlEnabled === state.htmlEnabled ? doc : doc.alternate;
  const rendered = prepareDocument({ ...doc, ...(variant || doc) });
  doc.headings = rendered.headings; doc.title = rendered.title;
  doc.updateLinks = rendered.updateLinks;
  doc.updateLinks(state.nodes);
  ui.content.classList.remove('empty'); ui.content.replaceChildren(rendered.fragment);
  document.title = doc.title;
}
async function applyHTML() {
  const doc = state.document;
  if (!doc) return;
  const scroll = snapshot();
  const id = ++state.request;
  ++state.render;
  ui.html.disabled = true;
  try {
    displayDocument(doc);
    drawTree(); restore(scroll);
    await renderDiagrams();
    if (id !== state.request) return;
    await settleImages();
    if (id === state.request) restore(scroll);
  } catch (error) {
    if (id === state.request) { state.warnings.push(error.message); notices(); }
  } finally { if (id === state.request) ui.html.disabled = false; }
}
function themeState() {
  const dark = document.documentElement.dataset.theme === 'dark';
  ui.theme.setAttribute('aria-checked', String(dark));
  ui.theme.title = `Switch to ${dark ? 'light' : 'dark'} theme`;
  $('#theme-label').textContent = dark ? 'Dark' : 'Light';
}
ui.theme.addEventListener('click', () => {
  const scroll = snapshot();
  const request = state.request;
  const value = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = value;
  save('nopainmd.theme', value);
  themeState();
  renderDiagrams().then(() => { if (request === state.request) restore(scroll); });
});
themeState();

function width(value, persist = true) {
  const next = Math.max(50, Math.min(1000, value));
  document.documentElement.style.setProperty('--sidebar-width', `${next}px`);
  ui.divider.setAttribute('aria-valuenow', String(Math.round(next)));
  if (persist) save('nopainmd.sidebarWidth', next);
}
ui.divider.setAttribute('aria-valuenow', String(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')) || 300));
ui.divider.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  ui.divider.setPointerCapture(event.pointerId);
  document.body.classList.add('resizing');
});
ui.divider.addEventListener('pointermove', event => { if (ui.divider.hasPointerCapture(event.pointerId)) width(event.clientX); });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) ui.divider.addEventListener(type, event => {
  if (ui.divider.hasPointerCapture(event.pointerId)) ui.divider.releasePointerCapture(event.pointerId);
  document.body.classList.remove('resizing');
});
ui.divider.addEventListener('keydown', event => {
  const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')) || 300;
  const targets = { ArrowLeft: current - 10, ArrowRight: current + 10, Home: 50, End: 1000 };
  if (event.key in targets) { event.preventDefault(); width(targets[event.key]); }
});

function headingList(headings) {
  const root = document.createElement('ul');
  root.className = 'toc';
  const stack = [];
  for (const heading of headings) {
    while (stack.length && stack.at(-1).level >= heading.level) stack.pop();
    let list = root;
    if (stack.length) {
      const ancestor = stack.at(-1);
      if (!ancestor.list) { ancestor.list = document.createElement('ul'); ancestor.item.append(ancestor.list); }
      list = ancestor.list;
    }
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.textContent = heading.text;
    link.href = fileURL(state.document.path, `#${encodeURIComponent(heading.id)}`);
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
    let node = file;
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
});
function drawTree() {
  if (!state.config) return;
  state.document?.updateLinks(state.nodes);
  const tree = activeTree();
  const top = ui.treeScroll.scrollTop;
  const left = ui.treeScroll.scrollLeft;
  const groups = new Map();
  for (const node of tree.nodes.values()) {
    if (node.external && node.path !== state.document?.path) continue;
    if (!groups.has(node.parent)) groups.set(node.parent, []);
    groups.get(node.parent).push(node);
  }
  function branch(parentPath) {
    const list = document.createElement('ul'); list.className = 'files';
    const nodes = (groups.get(parentPath) || []).sort((a, b) => Number(Boolean(b.external)) - Number(Boolean(a.external)) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    // Auto-expand only after indexing finishes.
    if (!state.busy && nodes.length === 1 && nodes[0].type === 'directory' && !tree.collapsed.has(nodes[0].path)) tree.expanded.add(nodes[0].path);
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
          if (tree.expanded.has(node.path)) { tree.expanded.delete(node.path); tree.collapsed.add(node.path); }
          else { tree.expanded.add(node.path); tree.collapsed.delete(node.path); }
          drawTree();
          [...ui.tree.querySelectorAll('.folder-row')].find(button => button.title === node.path)?.focus({ preventScroll: true });
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
function selectionNodes(reveal) {
  for (const [file, node] of state.nodes) if (node.external) state.nodes.delete(file);
  const doc = state.document;
  const priority = new Map();
  if (doc && !doc.external) {
    const ancestors = [];
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
function mergeIndex(result) {
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
  state.limits = [...new Set([...result.limits, ...(capped.limited ? ['nodes'] : [])])];
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
function showError(message, file) {
  ui.content.replaceChildren(); ui.content.classList.add('empty');
  const box = document.createElement('div'); box.append(document.createTextNode(message));
  if (file) { const name = document.createElement('span'); name.className = 'error-path'; name.textContent = file; box.append(document.createElement('br'), name); }
  ui.content.append(box);
}

async function renderDiagrams() {
  const revision = ++state.render;
  const blocks = [...ui.content.querySelectorAll('.mermaid-block')];
  ui.print.disabled = true;
  if (!blocks.length) { ui.print.disabled = false; return; }
  for (const block of blocks) block.source ??= block.querySelector('.mermaid-source')?.textContent || '';
  const active = () => state.render === revision;
  const task = async () => {
    if (!active()) return;
    try {
      await document.fonts.ready;
      mermaidModule ??= import('/vendor/mermaid/mermaid.esm.min.mjs');
      const { default: mermaid } = await mermaidModule;
      // Strip Mermaid helper functions from the saved config.
      mermaidDefaults ??= JSON.parse(JSON.stringify(mermaid.mermaidAPI.getConfig()));
      const font = getComputedStyle(ui.content);
      const typography = diagramTypography(mermaidDefaults, parseFloat(font.fontSize), font.fontFamily, parseFloat(mermaidDefaults.themeVariables.fontSize));
      const currentTheme = document.documentElement.dataset.theme;
      for (let i = 0; i < blocks.length && active(); i++) {
        const block = blocks[i];
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
              themeVariables: { ...typography.themeVariables, darkMode: dark, background: dark ? '#111111' : '#fafafa', primaryColor: fill, secondaryColor: fill, tertiaryColor: fill, primaryTextColor: text, secondaryTextColor: text, tertiaryTextColor: text, textColor: text, titleColor: text, noteTextColor: text, noteBkgColor: fill, lineColor: line, primaryBorderColor: line, secondaryBorderColor: line, tertiaryBorderColor: line, fontFamily: font.fontFamily, fontSize: font.fontSize },
              flowchart: { ...typography.flowchart, useMaxWidth: false }, sequence: { ...typography.sequence, useMaxWidth: false },
            });
            const { svg } = await mermaid.render(`diagram-${revision}-${i}-${variant}`, block.source);
            if (!active()) return;
            const wrapper = document.createElement('div'); wrapper.className = `mermaid-${variant}`; wrapper.innerHTML = svg;
            variants.push(wrapper);
          }
          block.replaceChildren(...variants);
        } catch (error) {
          if (!active()) return;
          const message = document.createElement('p'); message.className = 'mermaid-error'; message.textContent = `Could not render Mermaid diagram: ${String(error.message || error).split('\n')[0]}`;
          const source = document.createElement('pre'); source.textContent = block.source;
          block.replaceChildren(message, source);
        }
      }
    } catch (error) {
      if (active()) for (const block of blocks) {
        const message = document.createElement('p'); message.className = 'mermaid-error'; message.textContent = `Mermaid is unavailable: ${String(error.message || error).split('\n')[0]}`;
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
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
  const target = id && [...ui.content.querySelectorAll('[id]')].find(node => node.id === id);
  if (target) target.scrollIntoView({ block: 'start' });
  else ui.panel.scrollTo(0, 0);
}

async function load({ refresh = false, index = false, initial = false } = {}) {
  const scroll = snapshot();
  state.controller?.abort();
  state.controller = new AbortController();
  const id = ++state.request;
  ++state.render;
  state.busy = true;
  ui.html.disabled = true;
  ui.reload.disabled = true; ui.reload.classList.add('busy'); ui.reload.setAttribute('aria-busy', 'true');
  try {
    const config = await api('/api/config');
    if (id !== state.request) return;
    configure(config);
    state.warnings = state.config.warnings;
    const file = new URL(location.href).searchParams.get('file');
    state.selected = file;
    state.document = null;
    if (file) {
      try {
        const doc = await api('/api/document', { file, html: state.htmlEnabled, variants: true });
        if (id !== state.request) return;
        displayDocument(doc);
        state.document = doc;
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        if (id !== state.request) return;
        showError(error.status === 404 ? 'File not found' : error.message, file);
        document.title = basename(file);
        // Remove missing selections even after a partial scan.
        state.nodes.delete(file);
      }
    } else { showError('Select a Markdown file'); document.title = 'NoPainMD'; }
    ui.print.hidden = !state.document;
    selectionNodes(!refresh);
    drawTree();
    await renderDiagrams();
    if (id !== state.request) return;
    if (index || refresh || initial) {
      const result = await api('/api/index', state.document ? { selected: state.document.path } : {});
      if (id !== state.request) return;
      mergeIndex(result); drawTree();
    }
    await settleImages();
    if (id !== state.request) return;
    if (refresh) restore(scroll); else scrollHeading();
    notices();
  } catch (error) {
    if (error.name !== 'AbortError' && id === state.request) { state.warnings.push(error.message); notices(); }
  } finally {
    if (id === state.request) {
      state.busy = false; ui.html.disabled = false; ui.reload.disabled = false; ui.reload.classList.remove('busy'); ui.reload.removeAttribute('aria-busy'); drawTree();
    }
  }
}
ui.reload.addEventListener('click', () => load({ refresh: true }));
ui.print.addEventListener('click', () => { if (!ui.print.disabled) window.print(); });
document.addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (!link || link.target === '_blank' || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin) return;
  if (link.getAttribute('href')?.startsWith('#')) {
    event.preventDefault(); history.pushState(null, '', fileURL(state.document.path, url.hash)); scrollHeading(); return;
  }
  if (url.pathname !== '/' || !url.searchParams.has('file')) return;
  event.preventDefault();
  const same = url.searchParams.get('file') === state.document?.path;
  history.pushState(null, '', url);
  if (same) {
    if (state.filtered.query && link.classList.contains('file-row')) { selectionNodes(true); drawTree(); }
    scrollHeading();
  } else load();
});
window.addEventListener('popstate', () => {
  if (new URL(location.href).searchParams.get('file') === state.document?.path) scrollHeading(); else load();
});
load({ initial: true });
