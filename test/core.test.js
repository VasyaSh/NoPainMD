import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { get } from 'node:http';
import { createConfig } from '../dist/src/config.js';
import { indexDirectory } from '../dist/src/indexer.js';
import { renderMarkdown } from '../dist/src/markdown.js';
import { within, fileURL, regularFile } from '../dist/src/paths.js';
import { createApp } from '../dist/src/server.js';
import { capTreeNodes } from '../dist/shared/tree-nodes.js';
import { fileNodes } from '../dist/src/paths.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nopainmd-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('configuration honors precedence, validates live settings, and recovers from unreadable .env', async t => {
  const root = await fixture(t);
  assert.equal((await createConfig(root, {}, {})()).baseDir, '.');
  const read = createConfig(root, { port: 4444 }, { NOPAINMD_BASE_DIR: '/from-env', NOPAINMD_PORT: '5555', NOPAINMD_INDEX_MAX_NODES: '20' });
  await writeFile(path.join(root, '.env'), 'NOPAINMD_BASE_DIR="../Project docs"\nNOPAINMD_PORT=3333\nNOPAINMD_FONT="Times New Roman"\nNOPAINMD_FONT_ZOOM=125\nNOPAINMD_INDEX_MAX_NODES=10');
  let config = await read();
  assert.equal(config.port, 4444); assert.equal(config.font, 'Times New Roman'); assert.equal(config.fontZoom, 125); assert.equal(config.maxNodes, 10);
  assert.equal(config.baseDir, '../Project docs');
  await writeFile(path.join(root, '.env'), 'NOPAINMD_INDEX_MAX_NODES=2\nNOPAINMD_FONT_ZOOM=-5');
  config = await read();
  assert.equal(config.maxNodes, 2); assert.equal(config.fontZoom, 125); assert.match(config.warnings[0], /FONT_ZOOM/);
  assert.equal(config.baseDir, '/from-env');
  await writeFile(path.join(root, '.env'), 'NOPAINMD_BASE_DIR=""');
  config = await read();
  assert.equal(config.baseDir, '/from-env');
  assert.match(config.warnings.join('\n'), /Invalid NOPAINMD_BASE_DIR/);
  assert.equal((await read()).htmlEnabled, true);
  for (const [value, expected] of [['false', false], ['ON', true], ['0', false], ['yes', true]]) {
    await writeFile(path.join(root, '.env'), `NOPAINMD_HTML_ENABLED=${value}`);
    assert.equal((await read()).htmlEnabled, expected);
  }
  await writeFile(path.join(root, '.env'), 'NOPAINMD_HTML_ENABLED=invalid');
  const invalid = await read();
  assert.equal(invalid.htmlEnabled, true);
  assert.match(invalid.warnings.join('\n'), /Invalid NOPAINMD_HTML_ENABLED/);
  const file = path.join(root, '.env');
  await writeFile(file, 'NOPAINMD_FONT_ZOOM=125'); await read();
  await rm(file); await mkdir(file);
  const unreadable = await read();
  assert.equal(unreadable.fontZoom, 125); assert.equal(unreadable.readErrors, 1);
  assert.doesNotMatch(unreadable.warnings.join('\n'), /EISDIR|readFile|stack/);
  await rm(file, { recursive: true }); await writeFile(file, 'NOPAINMD_FONT_ZOOM=150');
  assert.equal((await read()).fontZoom, 150);
});

test('document HTML option uses the environment default and permits a per-browser override', async t => {
  const root = await fixture(t);
  const file = path.join(root, 'inline.markdown');
  await writeFile(file, '# A <em>title</em>\nUse <kbd>Ctrl</kbd>.');
  const app = await createApp({ root });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.stop());
  const url = `http://127.0.0.1:${app.server.address().port}/api/document?${new URLSearchParams({ file })}`;
  const enabled = await (await fetch(url)).json();
  assert.match(enabled.html, /<kbd>Ctrl<\/kbd>/);
  assert.equal(enabled.title, 'A title');
  assert.ok(Object.values(enabled.markers).some(marker => marker.kind === 'heading'));
  const cached = await (await fetch(`${url}&variants=true`)).json();
  assert.equal(cached.htmlEnabled, true);
  assert.match(cached.alternate.html, /&lt;kbd&gt;.*Ctrl.*&lt;\/kbd&gt;/);
  await writeFile(path.join(root, '.env'), 'NOPAINMD_HTML_ENABLED=false');
  assert.match((await (await fetch(url)).json()).html, /&lt;kbd&gt;.*Ctrl.*&lt;\/kbd&gt;/);
  assert.match((await (await fetch(`${url}&html=true`)).json()).html, /<kbd>Ctrl<\/kbd>/);
  assert.equal((await fetch(`${url}&html=invalid`)).status, 400);
});

test('heading extraction uses parsed headings, correct title, duplicate anchors, and single H1 omission', () => {
  const result = renderMarkdown('#### First *title*\n# Lone title\n## Café\n### Child\n## Café\n```md\n# not a heading\n```', '/tmp/test.md');
  assert.equal(result.title, 'First title');
  assert.deepEqual(result.headings.map(h => h.id), ['café', 'child', 'café-1']);
  assert.match(result.html, /id="lone-title"/);
  assert.equal(renderMarkdown('No headings', '/tmp/plain.md').title, 'plain.md');
  assert.equal(renderMarkdown('Setext\n====', '/tmp/plain.md').title, 'Setext');
  assert.equal(renderMarkdown('# One\n# Two', '/tmp/plain.md').headings.length, 2);
  const empty = renderMarkdown('# !!!\n# ???\n## !!!', '/tmp/plain.md');
  assert.deepEqual(empty.headings.map(h => h.id), ['section', 'section-1', 'section-2']);
  const formatted = renderMarkdown('# ![Picture](pic.png) `code`<br>title', '/tmp/plain.md', '', { htmlEnabled: true });
  assert.equal(formatted.title, 'Picture code title');
});

test('Markdown supports extras, literal Mermaid source, SVG markup, and safe links/images', () => {
  const result = renderMarkdown('[guide](sub/guide%20%26%23.md#go)\n![image](img.png)\n\n<script>alert(1)</script>\n\n- [x] Done\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```mermaid\nflowchart LR\n A["<script>"] --> B\n```', '/tmp/readme.md', 'token');
  assert.match(result.html, /href="sub\/guide%20%26%23.md#go"/);
  assert.match(result.html, /\/api\/image\?file=/);
  assert.match(result.html, /disabled/); assert.match(result.html, /<table>/);
  assert.doesNotMatch(result.html, /<script>/); assert.match(result.html, /mermaid-source/);
  for (const source of [
    '<img src="![nested](image.png)" alt="**bold**">',
    '<!-- ![hidden](image.png) -->',
    '<script>![script](image.png)</script>',
    '<![CDATA[<img src="image.png">]]>',
    '<div><img src="image.png"></div>',
  ]) {
    const html = renderMarkdown(source, '/tmp/readme.md').html;
    assert.doesNotMatch(html, /<(?:img|script|div|strong)\b/);
    assert.ok(html.includes(source.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')));
  }
  for (const source of [
    '![inline](image.png "Title")',
    '![reference][picture]\n\n[picture]: image.png "Title"',
    '![picture][]\n\n[picture]: image.png',
    '![picture]\n\n[picture]: image.png',
  ]) {
    for (const htmlEnabled of [false, true]) {
      const html = renderMarkdown(source, '/tmp/readme.md', 'token', { htmlEnabled }).html;
      assert.match(html, /<img src="\/api\/image\?file=%2Ftmp%2Fimage\.png&amp;token=token"/);
    }
  }
  for (const source of ['https://example.com/image.png', '//example.com/image.png', '#image']) {
    assert.ok(renderMarkdown(`![image](${source})`, '/tmp/readme.md').html.includes(`src="${source}"`));
  }
  assert.match(renderMarkdown('[web](https://example.com)', '/tmp/readme.md').html, /rel="noopener noreferrer"/);
  const svg = '<svg viewBox="0 0 100 60">\n\n<!-- </svg> -->\n<svg><text>**literal**</text></svg>\n\n</svg>';
  const rendered = renderMarkdown(`# Before\n\n${svg}\n\n## After\nInline <svg><text>*literal*</text></svg>.\n\n\`\`\`svg\n${svg}\n\`\`\``, '/tmp/svg.md', '', { htmlEnabled: true });
  assert.ok(rendered.html.includes(svg));
  assert.match(rendered.html, /Inline <svg><text>\*literal\*<\/text><\/svg>\./);
  assert.match(rendered.html, /<code class="language-svg">&lt;svg/);
  assert.deepEqual(rendered.headings.map(heading => heading.text), ['After']);
  assert.doesNotMatch(renderMarkdown(svg, '/tmp/svg.md').html, /<svg/);
  assert.match(renderMarkdown('<svg/>\n\nAfter', '/tmp/svg.md', '', { htmlEnabled: true }).html, /<p>After<\/p>/);
  for (const tag of ['figure', 'div', 'details']) {
    const wrapped = `<${tag}>\n  ${svg.replaceAll('\n', '\n    ')}\n</${tag}>`;
    const html = renderMarkdown(`${wrapped}\n\n**After**`, '/tmp/svg.md', '', { htmlEnabled: true }).html;
    assert.ok(html.includes(wrapped));
    assert.doesNotMatch(html, /<pre>|<em>/);
    assert.match(html, /<p><strong>After<\/strong><\/p>/);
  }
});

test('paths round-trip special characters and reject symlinks', async t => {
  const root = await fixture(t);
  const file = path.join(root, 'space & # 文.md');
  await writeFile(file, '# title');
  assert.equal(new URL(fileURL(file), 'http://localhost').searchParams.get('file'), file);
  assert.equal(within(root, `${root}-sibling/file.md`), false);
  assert.equal(await regularFile(file), file);
  await symlink(file, path.join(root, 'link.md'));
  await assert.rejects(regularFile(path.join(root, 'link.md')), /Symbolic links/);
  await assert.rejects(regularFile('relative.md'), /absolute/);
  for (const invalid of [null, '', `${root}\0file.md`]) await assert.rejects(regularFile(invalid), { status: 400 });
  await assert.rejects(regularFile(root), /not a regular file/);
  await assert.rejects(regularFile(path.parse(root).root), /not a regular file/);
  const linkedDirectory = path.join(root, 'linked');
  await symlink(root, linkedDirectory);
  await assert.rejects(regularFile(path.join(linkedDirectory, path.basename(file))), { status: 403 });
});

test('indexer includes both extensions and hidden paths, excludes non-Markdown branches, and shares stage budgets', async t => {
  const root = await fixture(t);
  for (const folder of ['.hidden', 'node_modules', 'docs', 'empty']) await mkdir(path.join(root, folder));
  const selected = path.join(root, 'docs', 'four.MarkDown');
  for (const file of ['.hidden/a.MD', 'node_modules/b.md', 'docs/three.markdown', 'docs/four.MarkDown', 'root.md', 'docs/ignored.markdown.txt', 'docs/ignored.mdx']) await writeFile(path.join(root, file), '# title');
  await symlink(root, path.join(root, 'loop'));
  const result = await indexDirectory({ root, selected });
  assert.equal(result.nodes.length, 8);
  assert.equal(result.filesFound, 5);
  assert.deepEqual(result.stages, ['directory', 'base']);
  assert.deepEqual(result.limits, []);
  assert.equal(result.nodes.some(node => ['empty', 'loop'].includes(node.name) || node.name.startsWith('ignored')), false);
  const limited = await indexDirectory({ root, selected, maxNodes: 2 });
  assert.deepEqual(limited.nodes.map(node => node.path), [path.join(root, 'docs'), selected]);
  assert.deepEqual(limited.limits, ['nodes']);
  const timed = await indexDirectory({ root, selected, maxMs: 1 });
  assert.equal(timed.filesFound, 1);
  assert.equal(timed.nodes.at(-1).path, selected);
  for (const name of ['space & #.markdown', 'UPPER.MARKDOWN']) {
    const rendered = renderMarkdown(`[Next](docs/${encodeURIComponent(name)}#section)`, path.join(root, 'index.md'));
    assert.ok(rendered.html.includes(`href="docs/${encodeURIComponent(name)}#section"`));
  }
  assert.equal(renderMarkdown('No heading', selected).title, 'four.MarkDown');
});

test('indexer enforces elapsed budget and supports cancellation', async t => {
  const root = await fixture(t);
  const result = await indexDirectory({ root, maxMs: 1 });
  assert.deepEqual(result.limits, ['time']);
  assert.ok(result.elapsedMs < 1000);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(indexDirectory({ root, signal: controller.signal }), { name: 'AbortError' });
});

test('node budget counts the fully expanded Markdown tree, not checked or omitted paths', async t => {
  const root = await fixture(t);
  for (let i = 0; i < 40; i++) {
    const folder = path.join(root, `ignored-${i}`, 'empty');
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'notes.txt'), 'Not Markdown');
    await writeFile(path.join(root, `data-${i}.json`), '{}');
  }
  await mkdir(path.join(root, 'docs', 'nested'), { recursive: true });
  const selected = path.join(root, 'docs', 'nested', 'first.md');
  await writeFile(selected, '# First\n## One\n### Two');
  await writeFile(path.join(root, 'docs', 'nested', 'second.md'), '# Second');
  const result = await indexDirectory({ root, selected, maxNodes: 4 });
  assert.deepEqual(result.nodes.map(node => node.name).sort(), ['docs', 'first.md', 'nested', 'second.md']);
  assert.equal(result.filesFound, 2);
  assert.deepEqual(result.limits, []);
  const limited = await indexDirectory({ root, selected, maxNodes: 3 });
  assert.equal(limited.nodes.length, 3);
  assert.deepEqual(limited.nodes.map(node => node.name), ['docs', 'nested', 'first.md']);
  assert.deepEqual(limited.limits, ['nodes']);
  const tooDeep = await indexDirectory({ root, selected, maxNodes: 2 });
  assert.deepEqual(tooDeep.nodes, []);
  assert.deepEqual(tooDeep.limits, ['nodes']);
});

test('navigation and cached partial trees budget complete file paths without empty directories', () => {
  const root = path.resolve('/base');
  const selected = fileNodes(root, path.join(root, 'selected.md'));
  const cached = fileNodes(root, path.join(root, 'docs', 'nested', 'other.md'));
  const empty = { path: path.join(root, 'empty'), parent: root, name: 'empty', type: 'directory' };
  let result = capTreeNodes([...selected, empty, ...cached], root, 3);
  assert.deepEqual([...result.nodes.values()], selected);
  assert.equal(result.limited, true);
  result = capTreeNodes([...selected, empty, ...cached], root, 4);
  assert.equal(result.nodes.size, 4);
  assert.equal(result.nodes.has(empty.path), false);
  assert.equal(result.limited, false);
  result = capTreeNodes([...cached, ...selected], root, 2);
  assert.equal(result.nodes.size, 0);
  assert.equal(result.limited, true);
  const orphan = { path: path.join(root, 'missing', 'orphan.md'), parent: path.join(root, 'missing'), name: 'orphan.md', type: 'file' };
  const cycle = { path: path.join(root, 'cycle'), parent: path.join(root, 'cycle'), name: 'cycle', type: 'directory' };
  const cyclicFile = { ...orphan, path: path.join(cycle.path, 'orphan.md'), parent: cycle.path };
  result = capTreeNodes([...selected, ...selected, orphan, cycle, cyclicFile], root, 10);
  assert.deepEqual([...result.nodes.values()], selected);
  assert.equal(result.limited, false);
});

test('external selection is pinned but its directory is not indexed', async t => {
  const root = await fixture(t); const external = await fixture(t);
  await writeFile(path.join(root, 'internal.md'), '# Internal');
  const selected = path.join(external, 'outside.md');
  await writeFile(selected, '# External'); await writeFile(path.join(external, 'sibling.md'), '# Sibling');
  const result = await indexDirectory({ root, selected, maxNodes: 2 });
  assert.equal(result.nodes[0].external, true);
  assert.equal(result.nodes[0].parent, root);
  assert.equal(result.nodes.length, 2);
  assert.deepEqual(result.stages, ['base']);
  const timed = await indexDirectory({ root, selected, maxNodes: 1, maxMs: 1 });
  assert.equal(timed.nodes.length, 1);
  assert.equal(timed.nodes[0].path, selected);
  assert.ok(timed.limits.includes('time'));
});

test('HTTP serves documents and permitted assets without exposing unrelated files', async t => {
  const root = await fixture(t); const external = await fixture(t);
  const file = path.join(external, 'outside.md');
  await writeFile(file, '# Outside\n![pic](image.svg)');
  await writeFile(path.join(external, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(path.join(root, '.env'), 'SECRET=test');
  const app = await createApp({ root });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.stop());
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const doc = await (await fetch(`${url}/api/document?${new URLSearchParams({ file })}`)).json();
  assert.equal(doc.external, true); assert.equal(doc.title, 'Outside');
  const src = doc.html.match(/src="([^"]+)/)[1].replaceAll('&amp;', '&');
  assert.equal((await fetch(url + src)).status, 200);
  assert.equal((await fetch(`${url}/api/image?${new URLSearchParams({ file: path.join(external, 'image.svg') })}`)).status, 403);
  assert.equal((await fetch(`${url}/api/image?${new URLSearchParams({ file: path.join(root, '.env') })}`)).status, 403);
  assert.equal((await fetch(`${url}/api/document?file=/nonexistent/absent.md`)).status, 404);
  assert.equal((await fetch(`${url}/.env`)).status, 404);
  for (const [route, options, status, message] of [
    ['/api/config', { method: 'POST' }, 405, 'Method not allowed'],
    ['/api/config', { headers: { Origin: 'https://untrusted.example' } }, 403, 'Cross-origin requests are not permitted'],
    ['/api/unknown', {}, 404, 'Not found'],
    ['/api/document', {}, 400, 'An absolute filesystem path is required.'],
    ['/..%2fpackage.json', {}, 404, 'Not found'],
    ['/%ZZ', {}, 500, 'Unable to complete the request. Please try again.'],
  ]) {
    const response = await fetch(url + route, options);
    assert.equal(response.status, status, route);
    assert.deepEqual(await response.json(), { error: message }, route);
  }
  const rejectedHost = await new Promise((resolve, reject) => {
    get(`${url}/api/config`, { headers: { Host: 'untrusted.example' } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(rejectedHost, 403);
  assert.equal((await fetch(`${url}/api/config`, { headers: { Origin: url } })).status, 200);
  for (const route of ['/', '/style.css', src]) {
    const get = await fetch(url + route);
    assert.equal(get.status, 200);
    assert.equal(get.headers.get('x-content-type-options'), 'nosniff');
    const head = await fetch(url + route, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-type'), get.headers.get('content-type'));
    assert.equal(await head.text(), '');
  }
  assert.match((await fetch(url + src)).headers.get('content-security-policy'), /sandbox/);
});
