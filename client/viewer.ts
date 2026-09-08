import template from '../public/viewer.html';
import styles from '../public/style.css';
import { createHTTPSource } from './source.js';
import { startViewer } from './runtime.js';
import type { NoPainMDViewer, ViewerOptions } from './types.js';

export { createHTTPSource } from './source.js';
export type { HTTPSourceOptions } from './source.js';
export type * from './types.js';

const mounted = new WeakSet<HTMLElement>();
const fontSets = new WeakMap<Document, Map<string, { faces: FontFace[]; users: number }>>();

function fonts(document: Document, base: URL): () => void {
  const sets = fontSets.get(document) ?? new Map<string, { faces: FontFace[]; users: number }>();
  fontSets.set(document, sets);
  let entry = sets.get(base.href);
  if (!entry) {
    const faces = [
      ['Regular', '400', 'normal'], ['Bold', '700', 'normal'],
      ['Italic', '400', 'italic'], ['BoldItalic', '700', 'italic'],
    ].map(([name, weight, style]) => new FontFace('Open Sans', `url(${JSON.stringify(new URL(`fonts/OpenSans-${name}.ttf`, base).href)})`, { weight, style }));
    for (const face of faces) document.fonts.add(face);
    entry = { faces, users: 0 };
    sets.set(base.href, entry);
  }
  entry.users++;
  return () => {
    if (--entry.users === 0) {
      for (const face of entry.faces) document.fonts.delete(face);
      sets.delete(base.href);
    }
  };
}

function assetStyles(options: ViewerOptions): { css: string; base: URL } {
  const base = options.assetBaseURL === undefined ? new URL('./', import.meta.url) : new URL(options.assetBaseURL, document.baseURI);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const css = styles.replaceAll("url('./fonts/", `url('${new URL('fonts/', base).href}`);
  return { css, base };
}

/** Mount an isolated viewer without changing the host's URL or title by default. */
export function mountNoPainMD(container: HTMLElement, options: ViewerOptions = {}): NoPainMDViewer {
  if (mounted.has(container)) throw new Error('This container already has a NoPainMD viewer. Destroy it before mounting again.');
  if (container.ownerDocument !== document) throw new Error('Mount the viewer in the document that imported it.');
  const host = document.createElement('div');
  host.style.width = '100%'; host.style.height = '100%';
  const shadow = host.attachShadow({ mode: 'open' });
  const root = document.createElement('div');
  root.className = 'nopainmd-viewer';
  root.innerHTML = template;
  const { css, base } = assetStyles(options);
  const style = document.createElement('style'); style.textContent = css;
  shadow.append(style, root);
  container.append(host);
  const releaseFonts = fonts(document, base);
  const printFrames = new Set<HTMLIFrameElement>();
  function print() {
    const frame = document.createElement('iframe');
    frame.title = 'Print Markdown';
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;';
    printFrames.add(frame);
    document.body.append(frame);
    const target = frame.contentDocument;
    const window = frame.contentWindow;
    if (!target || !window) { frame.remove(); printFrames.delete(frame); return; }
    target.documentElement.className = 'nopainmd-viewer';
    target.documentElement.style.cssText = root.style.cssText;
    const printStyle = target.createElement('style'); printStyle.textContent = css;
    target.head.append(printStyle);
    target.title = root.querySelector('h1, h2, h3, h4, h5, h6')?.textContent ?? 'NoPainMD';
    const content = root.querySelector('#content')?.cloneNode(true);
    if (content) target.body.append(content);
    window.addEventListener('afterprint', () => { frame.remove(); printFrames.delete(frame); }, { once: true });
    void (async () => {
      await target.fonts.ready;
      await Promise.all([...target.images].map(image => Promise.race([image.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))])));
      if (frame.isConnected) window.print();
    })().catch(() => { frame.remove(); printFrames.delete(frame); });
  }
  let viewer: NoPainMDViewer;
  try { viewer = startViewer(root, root, options, options.source ?? createHTTPSource({ baseURL: options.apiBaseURL }), print); }
  catch (error) { releaseFonts(); host.remove(); throw error; }
  mounted.add(container);
  let destroyed = false;
  return {
    ...viewer,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      viewer.destroy();
      for (const frame of printFrames) frame.remove();
      printFrames.clear(); releaseFonts(); host.remove(); mounted.delete(container);
    },
  };
}
