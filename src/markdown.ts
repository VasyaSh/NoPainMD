import type { Token } from 'markdown-it';
import type { Heading, RenderedMarkdown, RenderMarker } from '../shared/types.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import { headingId } from '../shared/headings.js';
import { svgMarkup } from './svg-markup.js';
import { literalHTML } from './literal-html.js';

function plain(tokens: Token[] | null = []): string {
  return (tokens ?? []).map(token => {
    if (token.type === 'image') return plain(token.children) || token.content;
    if (['text', 'code_inline'].includes(token.type)) return token.content;
    if (token.type === 'html_inline' && /^<br\s*\/?\s*>$/iu.test(token.content)) return ' ';
    if (['softbreak', 'hardbreak'].includes(token.type)) return ' ';
    return '';
  }).join('').trim();
}

export function renderMarkdown(source: string, file: string, imageToken = '', { htmlEnabled = false }: { htmlEnabled?: boolean } = {}): RenderedMarkdown {
  // Linkify in the browser after sanitization.
  const md = new MarkdownIt({ html: true, linkify: false }).use(taskLists).use(svgMarkup);
  if (!htmlEnabled) md.use(literalHTML);
  // Random markers distinguish renderer metadata from author HTML.
  const markers: Record<string, RenderMarker> = {};
  const mark = (metadata: RenderMarker) => { const key = randomUUID(); markers[key] = metadata; return key; };
  const headings: Heading[] = [];
  const used = new Set<string>();
  let firstHeading;
  let h1Count = 0;
  md.core.ruler.push('nopainmd', state => {
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (!token) continue;
      if (token.type !== 'heading_open') continue;
      const text = plain(state.tokens[i + 1]?.children ?? []);
      firstHeading ??= text;
      const id = headingId(text, used);
      token.attrSet('id', id);
      const level = Number(token.tag.slice(1));
      token.attrSet('data-nopainmd', mark({ kind: 'heading', outline: level <= 3 && /^#{1,3}$/u.test(token.markup) }));
      if (level === 1) h1Count++;
      if (level <= 3 && /^#{1,3}$/u.test(token.markup)) headings.push({ level, text, id });
    }
  });

  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    if ((tokens[idx]?.info ?? '').trim().split(/\s/u)[0]?.toLowerCase() === 'mermaid') {
      return `<div class="mermaid-block" data-nopainmd="${mark({ kind: 'mermaid' })}"><pre class="mermaid-source">${md.utils.escapeHtml(tokens[idx]?.content ?? '')}</pre></div>\n`;
    }
    return fence ? fence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  };

  function resolveLocal(href: string | null) {
    if (!href || href.startsWith('#') || href.startsWith('//') || /^[a-z][a-z\d+.-]*:/iu.test(href)) return null;
    const url = new URL(href, 'http://nopainmd.invalid/');
    const encodedPath = href.split(/[?#]/u)[0];
    try { return { file: path.resolve(path.dirname(file), decodeURIComponent(encodedPath ?? '')), hash: url.hash }; }
    catch { return null; }
  }
  md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
    const token = tokens[idx];
    if (!token) return '';
    if (/^https?:/iu.test(String(token.attrGet('href') || ''))) token.attrSet('rel', 'noopener noreferrer');
    return self.renderToken(tokens, idx, options);
  };
  const image = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (!token) return '';
    const target = resolveLocal(String(token.attrGet('src') ?? ''));
    if (target) token.attrSet('src', `/api/image?${new URLSearchParams({ file: target.file, token: imageToken })}`);
    return image ? image(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  };
  const html = md.render(source);
  const visibleHeadings = headings.filter(h => !(h.level === 1 && h1Count === 1));
  // Sanitize in public/document.js before display.
  return { html, markers, headings: visibleHeadings, title: firstHeading ?? path.basename(file) };
}
