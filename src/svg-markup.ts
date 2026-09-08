import type { MarkdownIt } from 'markdown-it';
function* markupTags(source: string, start: number, end: number) {
  const tags = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[a-z][\w:.-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>/giu;
  tags.lastIndex = start;
  let tag;
  while ((tag = tags.exec(source)) && tags.lastIndex <= end) yield tag;
}

function svgEnd(source: string, start: number, end = source.length): number {
  if (!/^<svg[\s/>]/iu.test(source.slice(start, start + 5))) return -1;
  let depth = 0;
  for (const tag of markupTags(source, start, end)) {
    if (!/^<\/?svg[\s/>]/iu.test(tag[0])) continue;
    if (tag[0].startsWith('</')) depth--;
    else if (!/\/\s*>$/u.test(tag[0])) depth++;
    if (depth === 0) return tag.index + tag[0].length;
  }
  return -1;
}

export function svgMarkup(md: MarkdownIt): void {
  md.block.ruler.before('html_block', 'svg_block', (state, startLine, endLine, silent) => {
    if (!state.md.options.html || (state.sCount[startLine] ?? 0) - state.blkIndent >= 4) return false;
    const start = (state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
    let svgStart = start;
    if (/^<(?:figure|div|section|article|aside|details|blockquote)[\s>]/iu.test(state.src.slice(start))) {
      // Preserve SVG that begins inside an HTML block before its first blank line.
      let next = startLine + 1;
      while (next < endLine && !state.isEmpty(next)) next++;
      const opening = [...markupTags(state.src, start, (state.eMarks[next - 1] ?? state.src.length))].find(tag => /^<svg[\s/>]/iu.test(tag[0]));
      if (!opening) return false;
      svgStart = opening.index;
    }
    const end = svgEnd(state.src, svgStart, (state.eMarks[endLine - 1] ?? state.src.length));
    if (end < 0) return false;
    if (silent) return true;
    let next = startLine + 1;
    while (next < endLine && (state.bMarks[next] ?? state.src.length) < end) next++;
    const token = state.push('html_block', '', 0);
    token.block = true;
    token.content = state.getLines(startLine, next, state.blkIndent, true);
    token.map = [startLine, next];
    state.line = next;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote'] });
  md.inline.ruler.before('html_inline', 'svg_inline', (state, silent) => {
    if (!state.md.options.html) return false;
    const end = svgEnd(state.src, state.pos, state.posMax);
    if (end < 0) return false;
    if (!silent) state.push('html_inline', '', 0).content = state.src.slice(state.pos, end);
    state.pos = end;
    return true;
  });
}
