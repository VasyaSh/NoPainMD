import test from 'node:test';
import assert from 'node:assert/strict';
import { textLinks } from '../public/text-links.js';

test('text links recognize qualified URLs and relative Markdown paths without swallowing punctuation', () => {
  const urls = [
    'https://example.com/path_(detail)?a=1&b=2#heading', 'http://localhost:3000/',
    'ftp://files.example.com/archive.zip', 'ftps://files.example.com/archive.zip',
    'mailto:reader@example.com', 'tel:+14155552671',
  ];
  const paths = ['../SKILL.md', '../../../guides/next.MARKDOWN#setup', './guide.md', 'docs/space%20name.md', 'sibling.md'];
  for (const [values, wrap, external] of [[urls, value => `(${value}).`, true], [paths, value => `[${value}],`, false]]) {
    const text = values.map(wrap).join(' ');
    const matches = textLinks(text);
    assert.deepEqual(matches.map(match => match.text), values);
    for (const match of matches) {
      assert.equal(match.href, external ? match.text : undefined);
      assert.equal(text.slice(match.index, match.index + match.text.length), match.text);
    }
  }
  for (const value of [
    'www.example.com', 'example.com', 'reader@example.com', '//example.com', 'https://', 'https:/example.com',
    'mailto:reader', 'tel:', 'javascript:alert(1)', 'data:text/html,bad', 'gopher://example.com', 'https://example.com/%ZZ',
    '/tmp/SKILL.md', 'C:\\docs\\SKILL.md', '\\\\server\\share\\SKILL.md', 'file:///tmp/SKILL.md', 'https:/broken.md', 'docs/file.mdx', 'file.md.bak',
  ]) {
    assert.deepEqual(textLinks(value), [], value);
  }
});
