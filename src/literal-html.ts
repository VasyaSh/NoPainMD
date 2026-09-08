import type { MarkdownIt, Token } from 'markdown-it';

function literalTokens(tokens: Token[]): void {
  for (const token of tokens) {
    if (token.type === 'html_block') token.type = 'code_block';
    else if (token.type === 'html_inline') token.type = 'code_inline';
    if (token.children) literalTokens(token.children);
  }
}

export function literalHTML(md: MarkdownIt): void {
  // Escape author HTML before the task-list plugin adds its own checkbox markup.
  md.core.ruler.after('inline', 'literal_html', state => literalTokens(state.tokens));
}
