export interface TextLink { index: number; text: string; href?: string }

// The caller checks index membership.
export function textLinks(text: string): TextLink[] {
  const matches: TextLink[] = [];
  for (const chunk of text.matchAll(/[^\s<>"'`]+/gu)) {
    let value = chunk[0];
    let index = chunk.index;
    while (/^[([{]/u.test(value)) { value = value.slice(1); index++; }
    // Exclude punctuation and unmatched closing brackets.
    while (value) {
      const last = value.at(-1) ?? '';
      const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
      const opening = pairs[last];
      if (/[.,;!?]/u.test(last) || (opening && value.split(last).length > value.split(opening).length)) value = value.slice(0, -1);
      else break;
    }
    if (!value) continue;
    let href;
    try {
      if (/^(?:https?|ftps?):\/\/[^/?#]/iu.test(value) && !/%(?![\da-f]{2})/iu.test(value)) {
        const url = new URL(value);
        if (url.hostname && !value.includes('\\')) href = value;
      } else if (/^mailto:[^\s@/?#]+@[^\s@/?#]+(?:\?[^\s]*)?$/iu.test(value)) href = value;
      else if (/^tel:\+?\d[\d().-]*(?:;ext=\d+)?$/iu.test(value)) href = value;
    } catch {}
    if (href) matches.push({ index, text: value, href });
    else if (!/^[\\/]|^[a-z][a-z\d+.-]*:/iu.test(value) && /\.(?:md|markdown)(?:[?#].*)?$/iu.test(value)) {
      matches.push({ index, text: value });
    }
  }
  return matches;
}
