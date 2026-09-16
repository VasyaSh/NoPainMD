import type { MarkdownIt } from 'markdown-it';

export function frontMatter(md: MarkdownIt): void {
  md.block.ruler.before('hr', 'front_matter', (state, startLine, endLine, silent) => {
    if (startLine !== 0 || !/^\uFEFF?---[ \t]*$/u.test(state.src.slice(0, state.eMarks[0]))) return false;
    for (let line = 1; line < endLine; line++) {
      if (!/^(?:---|\.\.\.)[ \t]*$/u.test(state.src.slice(state.bMarks[line], state.eMarks[line]))) continue;
      if (silent) return true;
      const token = state.push('code_block', 'code', 0);
      token.block = true;
      token.content = state.getLines(0, line + 1, 0, true).replace(/^\uFEFF/u, '');
      token.map = [0, line + 1];
      state.line = line + 1;
      return true;
    }
    return false;
  });
}
