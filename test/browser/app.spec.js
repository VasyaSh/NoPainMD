import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../../dist/src/server.js';

let temp, root, external, app, base, docFile, logs, pageErrors;
const longText = '\n\nParagraph with enough content to scroll.\n'.repeat(100);
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  temp = await mkdtemp(path.join(os.tmpdir(), 'nopainmd-browser-'));
  root = path.join(temp, 'base'); external = path.join(temp, 'outside');
  await mkdir(path.join(root, 'docs', 'nested'), { recursive: true }); await mkdir(external);
  docFile = path.join(root, 'docs', 'guide & #.md');
  await writeFile(docFile, `# Guide\n## Start\nHello.\n### Detail\n[Plain](../plain.md)${longText}\n## End\nFinished.`);
  await writeFile(path.join(root, 'plain.md'), 'A plain document.');
  await writeFile(path.join(root, 'docs', 'nested', 'other.md'), '# Nested');
  await writeFile(path.join(external, 'outside.md'), '#### Outside title\n## External heading\n![image](picture.svg)');
  await writeFile(path.join(external, 'picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18"/></svg>');
  logs = [];
  app = await createApp({ root, log: line => logs.push(line) });
  await new Promise((resolve, reject) => app.server.once('error', reject).listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
test.afterEach(async () => {
  await app?.stop();
  if (temp) await rm(temp, { recursive: true, force: true });
  expect(pageErrors ?? []).toEqual([]);
});
const open = async (page, file) => {
  await page.goto(`${base}/${file ? `?${new URLSearchParams({ file })}` : ''}`);
  await expect(page.locator('#reload')).toBeEnabled();
};
const reload = async page => {
  await page.locator('#reload').click();
  await expect(page.locator('#reload')).toBeEnabled();
};
const viewerURL = (file, hash = '') => `/?${new URLSearchParams({ file })}${hash}`;

test('absolute URLs, heading list, history, fixed Print, and collapsed folders', async ({ page }) => {
  await open(page);
  await expect(page.locator('#base-path')).toHaveText(root);
  await expect(page.locator('.folder-row')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('.folder-row').click();
  await page.getByRole('link', { name: 'guide & #.md', exact: true }).click();
  await expect(page).toHaveTitle('Guide'); await expect(page.locator('#reload')).toBeEnabled();
  expect(new URL(page.url()).searchParams.get('file')).toBe(docFile);
  await expect(page.locator('.toc')).toContainText('Start'); await expect(page.locator('.toc')).not.toContainText('Guide');
  await expect(page.locator('.file-row.selected')).toHaveText('guide & #.md');
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toHaveText('');
  await expect(page.locator('#print svg')).toBeVisible();
  await page.evaluate(() => { window.print = () => { window.printCalled = true; }; });
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  expect(await page.evaluate(() => window.printCalled)).toBe(true);
  const before = await page.locator('#print').boundingBox();
  await page.locator('.toc a').filter({ hasText: 'End' }).click();
  expect(await page.locator('#document-panel').evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  expect((await page.locator('#print').boundingBox()).y).toBe(before.y);
  await page.reload(); await expect(page.locator('#reload')).toBeEnabled();
  await expect(page.locator('.folder-row').filter({ hasText: 'docs' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.folder-row').filter({ hasText: 'nested' })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('link', { name: 'plain.md', exact: true }).click();
  await expect(page).toHaveTitle('plain.md'); await page.goBack(); await expect(page).toHaveTitle('Guide');
});

test('selection follows collapsed ancestors in each search tree, survives Reload, and clears on navigation', async ({ page }) => {
  const file = path.join(root, 'docs', 'nested', 'other.md');
  await open(page, file);
  const docs = page.getByRole('button', { name: 'docs', exact: true });
  const nested = page.getByRole('button', { name: 'nested', exact: true });
  const selected = page.locator('#tree .selected');
  await expect(selected).toHaveText(['other.md']);
  await nested.click();
  await expect(selected).toHaveText(['nested']);
  await expect(selected).toHaveAttribute('aria-current', 'location');
  await expect(selected).toHaveCSS('font-weight', '700');
  await expect(selected).toHaveCSS('background-color', 'rgb(238, 238, 238)');
  await docs.click();
  await expect(selected).toHaveText(['docs']);
  await reload(page);
  await expect(selected).toHaveText(['docs']);
  await docs.click();
  await expect(selected).toHaveText(['nested']);
  await page.locator('#theme').click();
  await expect(selected).toHaveCSS('background-color', 'rgb(42, 42, 42)');
  await nested.click();
  await expect(selected).toHaveText(['other.md']);
  await expect(selected).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle('Nested');
  expect(new URL(page.url()).searchParams.get('file')).toBe(file);
  const search = page.getByRole('searchbox', { name: 'Quick Search .md', exact: true });
  await docs.click();
  await expect(selected).toHaveText(['docs']);
  await search.fill('other');
  await expect(selected).toHaveText(['other.md']);
  await nested.click();
  await expect(selected).toHaveText(['nested']);
  await reload(page);
  await expect(selected).toHaveText(['nested']);
  await search.fill('');
  await expect(selected).toHaveText(['docs']);
  await docs.click();
  await expect(selected).toHaveText(['other.md']);
  await search.fill('plain');
  await expect(selected).toHaveCount(0);
  await expect(page).toHaveTitle('Nested');
  await page.getByRole('link', { name: 'plain.md', exact: true }).click();
  await expect(page.locator('#reload')).toBeEnabled();
  await expect(selected).toHaveText(['plain.md']);
});

test('quick search matches filenames only and keeps filtered expansion separate', async ({ page }, testInfo) => {
  await mkdir(path.join(root, 'archive', 'deep'), { recursive: true });
  await mkdir(path.join(root, 'Guide folder'));
  await writeFile(path.join(root, 'archive', 'deep', 'My Guide.MARKDOWN'), '# Another title');
  await writeFile(path.join(root, 'archive', 'skip.md'), '# Skip');
  await writeFile(path.join(root, 'Guide folder', 'ordinary.md'), '# Guide');
  await open(page);
  const search = page.getByRole('searchbox', { name: 'Quick Search .md', exact: true });
  const docs = page.getByRole('button', { name: 'docs', exact: true });
  const archive = page.getByRole('button', { name: 'archive', exact: true });
  const deep = page.getByRole('button', { name: 'deep', exact: true });
  await expect(search).toHaveAttribute('placeholder', 'Quick Search .md');
  const searchBox = await search.boundingBox();
  const reloadBox = await page.locator('#reload').boundingBox();
  const headingBox = await page.locator('.directory-heading').boundingBox();
  expect(searchBox.x).toBeGreaterThan(reloadBox.x + reloadBox.width);
  expect(Math.abs(searchBox.y + searchBox.height / 2 - reloadBox.y - reloadBox.height / 2)).toBeLessThan(1);
  expect(Math.abs(searchBox.x + searchBox.width - headingBox.x - headingBox.width)).toBeLessThan(1);
  await archive.click();
  await expect(deep).toHaveAttribute('aria-expanded', 'false');
  let requests = 0;
  page.on('request', request => { if (request.url().includes('/api/')) requests++; });
  await search.fill('gUiDe');
  await expect(page.locator('.file-row')).toHaveText(['My Guide.MARKDOWN', 'guide & #.md']);
  await expect(page.locator('.folder-row[aria-expanded="false"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Guide folder', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'nested', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('search-light.png') });
  await page.locator('#theme').click();
  await page.screenshot({ path: testInfo.outputPath('search-dark.png') });
  await archive.click();
  await expect(archive).toHaveAttribute('aria-expanded', 'false');
  await search.fill('');
  await expect(archive).toHaveAttribute('aria-expanded', 'true');
  await expect(deep).toHaveAttribute('aria-expanded', 'false');
  await expect(docs).toHaveAttribute('aria-expanded', 'false');
  for (const query of ['nested', 'Paragraph', 'no match']) {
    await search.fill(query);
    await expect(page.locator('#tree')).toHaveText('No matching Markdown files.');
  }
  await search.fill('& #');
  await expect(page.locator('.file-row')).toHaveText(['guide & #.md']);
  await search.fill('.mArKdOwN');
  await expect(page.locator('.file-row')).toHaveText(['My Guide.MARKDOWN']);
  await expect(page.locator('#content')).toHaveText('Select a Markdown file');
  expect(requests).toBe(0);
  await page.locator('#divider').focus(); await page.keyboard.press('End');
  const wide = await search.boundingBox();
  const wideHeading = await page.locator('.directory-heading').boundingBox();
  expect(wide.width).toBe(256);
  expect(Math.abs(wide.x + wide.width - wideHeading.x - wideHeading.width)).toBeLessThan(1);
  await page.locator('#divider').focus(); await page.keyboard.press('Home');
  const narrow = await search.boundingBox();
  const sidebar = await page.locator('#sidebar').boundingBox();
  expect(narrow.x + narrow.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
  expect(narrow.width).toBeGreaterThan(20);
});

test('opening filtered results reveals their path in the unfiltered tree, including the current file', async ({ page }) => {
  await open(page, docFile);
  const search = page.getByRole('searchbox', { name: 'Quick Search .md', exact: true });
  const docs = page.getByRole('button', { name: 'docs', exact: true });
  const nested = page.getByRole('button', { name: 'nested', exact: true });
  await docs.click();
  await page.locator('#document-panel').evaluate(el => { el.scrollTop = 650; });
  await search.fill('OTHER');
  expect(await page.locator('#document-panel').evaluate(el => el.scrollTop)).toBe(650);
  await expect(page).toHaveTitle('Guide');
  await expect(page.locator('.file-row')).toHaveText(['other.md']);
  await page.getByRole('link', { name: 'other.md', exact: true }).click();
  await expect(page.locator('#reload')).toBeEnabled();
  await expect(page).toHaveTitle('Nested');
  expect(new URL(page.url()).searchParams.get('file')).toBe(path.join(root, 'docs', 'nested', 'other.md'));
  await expect(search).toHaveValue('OTHER');
  await search.fill('');
  await expect(docs).toHaveAttribute('aria-expanded', 'true');
  await expect(nested).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.file-row.selected')).toHaveText('other.md');
  await docs.click();
  await search.fill('other');
  await page.getByRole('link', { name: 'other.md', exact: true }).click();
  await search.fill('');
  await expect(docs).toHaveAttribute('aria-expanded', 'true');
  await expect(nested).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.file-row.selected')).toHaveText('other.md');
});

test('Reload reapplies quick search to changed entries and uses the latest query during indexing', async ({ page }) => {
  const removed = path.join(root, 'old-guide.md');
  await writeFile(removed, '# Old');
  await open(page, docFile);
  const search = page.getByRole('searchbox', { name: 'Quick Search .md', exact: true });
  const nested = page.getByRole('button', { name: 'nested', exact: true });
  await nested.click();
  await search.fill('GUIDE');
  await page.locator('#document-panel').evaluate(el => { el.scrollTop = 650; });
  await rm(removed);
  await mkdir(path.join(root, 'docs', 'new-depth'));
  await writeFile(path.join(root, 'docs', 'new-depth', 'guide-new.MARKDOWN'), '# New');
  await writeFile(path.join(root, 'docs', 'new-depth', 'noise.md'), '# Guide in content only');
  await writeFile(docFile, '# Updated Guide\n## Start' + longText + '\n## End');
  await reload(page);
  await expect(search).toHaveValue('GUIDE');
  await expect(page).toHaveTitle('Updated Guide');
  await expect(page.locator('.file-row')).toHaveText(['guide & #.md', 'guide-new.MARKDOWN']);
  await expect(page.locator('.file-row.selected')).toHaveText('guide & #.md');
  await expect(page.getByRole('button', { name: 'new-depth', exact: true })).toHaveAttribute('aria-expanded', 'true');
  expect(await page.locator('#document-panel').evaluate(el => el.scrollTop)).toBe(650);
  await search.fill('');
  await expect(nested).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'new-depth', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await search.fill('not yet found');
  const indexing = Promise.withResolvers();
  const release = Promise.withResolvers();
  await page.route('**/api/index?*', async route => { indexing.resolve(); await release.promise; await route.continue(); });
  await page.locator('#reload').click();
  await indexing.promise;
  try {
    await expect(page.locator('#reload')).toHaveAttribute('aria-busy', 'true');
    await search.fill('NEW');
  } finally { release.resolve(); }
  await expect(page.locator('#reload')).toBeEnabled();
  await expect(page.locator('.file-row')).toHaveText(['guide-new.MARKDOWN']);
  await expect(search).toHaveValue('NEW');
  await expect(page).toHaveTitle('Updated Guide');
});

test('.markdown supports tree selection, relative links, anchors, Reload, and external entries', async ({ page }) => {
  const file = path.join(root, 'docs', 'space & #.MARKDOWN');
  const outside = path.join(external, 'external.markdown');
  await writeFile(file, `# Long extension\n## Section\n[External](${viewerURL(outside)})`);
  await writeFile(outside, 'External document without headings.');
  await writeFile(path.join(root, 'plain.md'), '[Next](docs/space%20%26%20%23.MARKDOWN#section)');
  await open(page, path.join(root, 'plain.md'));
  await page.locator('#content a').click(); await expect(page.locator('#reload')).toBeEnabled();
  expect(new URL(page.url()).searchParams.get('file')).toBe(file);
  expect(new URL(page.url()).hash).toBe('#section');
  await expect(page).toHaveTitle('Long extension');
  await expect(page.locator('.file-row.selected')).toHaveText('space & #.MARKDOWN');
  await expect(page.locator('.toc a')).toHaveText('Section');
  await writeFile(file, `# Updated heading\n## Section\n[External](${viewerURL(outside)})`);
  await reload(page);
  await expect(page).toHaveTitle('Updated heading');
  await page.reload(); await expect(page.locator('#reload')).toBeEnabled();
  await expect(page.locator('.file-row.selected')).toHaveText('space & #.MARKDOWN');
  await page.locator('#content a').click(); await expect(page.locator('#reload')).toBeEnabled();
  expect(new URL(page.url()).searchParams.get('file')).toBe(outside);
  await expect(page).toHaveTitle('external.markdown');
  await expect(page.locator('#tree > ul > li').first()).toContainText('/**/external.markdown');
  expect(logs.some(line => line.startsWith('Found 4 Markdown files in '))).toBe(true);
});

test('relative Markdown and HTML links convert only indexed targets, regardless of ancestor depth or filtering', async ({ page }) => {
  const directory = path.join(root, 'docs', 'nested', 'deeper');
  const file = path.join(directory, 'links.md');
  const target = path.join(directory, 'space & #.MARKDOWN');
  const plain = path.join(root, 'plain.md');
  await mkdir(directory);
  await writeFile(target, '# Sibling\n## Here');
  await writeFile(plain, '# Plain' + longText + '\n## Landing');
  await writeFile(path.join(root, 'notes.txt'), 'Not Markdown');
  await writeFile(file, `# Connections
[Sibling](./space%20%26%20%23.MARKDOWN#here)
[Deep](../../../plain.md#landing)
[Encoded](..%2f..%2f..%2fplain.md#landing)
[Missing](../../../missing.md)
[Outside](../../../../outside/outside.md)
[Absolute](<${plain}>)
[Website](https://example.com/manual.md)
[Other type](../../../notes.txt)
[Heading](#connections)
<a href="../../../plain.md#landing">HTML deep</a>
<a href="${plain}">HTML absolute</a>
<a href="../../../../outside/outside.md">HTML outside</a>
`);
  await open(page, file);
  const link = name => page.locator('#content').getByRole('link', { name, exact: true });
  for (const name of ['Deep', 'Encoded', 'HTML deep']) {
    const href = new URL(await link(name).getAttribute('href'), base);
    expect(href.searchParams.get('file')).toBe(plain);
    expect(href.hash).toBe('#landing');
  }
  expect(new URL(await link('Sibling').getAttribute('href'), base).searchParams.get('file')).toBe(target);
  for (const [name, href] of [
    ['Absolute', plain], ['HTML absolute', plain], ['Outside', '../../../../outside/outside.md'],
    ['HTML outside', '../../../../outside/outside.md'], ['Missing', '../../../missing.md'],
    ['Website', 'https://example.com/manual.md'], ['Other type', '../../../notes.txt'], ['Heading', '#connections'],
  ]) await expect(link(name)).toHaveAttribute('href', href);
  await page.getByRole('button', { name: 'deeper', exact: true }).click();
  expect(new URL(await link('Sibling').getAttribute('href'), base).searchParams.get('file')).toBe(target);
  await page.getByRole('searchbox').fill('links');
  await expect(page.locator('.file-row')).toHaveText(['links.md']);
  expect(new URL(await link('Deep').getAttribute('href'), base).searchParams.get('file')).toBe(plain);
  await page.locator('#html-toggle').click(); await expect(page.locator('#html-toggle')).toBeEnabled();
  expect(new URL(await link('Deep').getAttribute('href'), base).searchParams.get('file')).toBe(plain);
  await page.locator('#html-toggle').click(); await expect(page.locator('#html-toggle')).toBeEnabled();
  expect(new URL(await link('HTML deep').getAttribute('href'), base).searchParams.get('file')).toBe(plain);
  await link('Deep').click(); await expect(page.locator('#reload')).toBeEnabled();
  await expect(page).toHaveTitle('Plain');
  expect(new URL(page.url()).searchParams.get('file')).toBe(plain);
  expect(new URL(page.url()).hash).toBe('#landing');
  expect(await page.locator('#document-panel').evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  await page.goBack(); await expect(page.locator('#reload')).toBeEnabled();
  await expect(page).toHaveTitle('Connections');
});

test('authored, bare, and inline-code links track index changes without rerendering or losing scroll', async ({ page }) => {
  const file = path.join(root, 'links.md');
  const target = path.join(root, 'target.md');
  await writeFile(file, '# Links\n[Target](target.md#target)\n<a href="target.md#target">HTML target</a>\n\nRead ./target.md.\n\n`./target.md`' + longText);
  await writeFile(target, '# Target');
  await writeFile(path.join(root, '.env'), 'NOPAINMD_INDEX_MAX_NODES=1');
  await open(page, file);
  const links = page.locator('#content').getByRole('link', { name: /^(Target|HTML target)$/ });
  const bare = page.locator('#content').getByRole('link', { name: './target.md', exact: true });
  const unchanged = async () => {
    await expect(links).toHaveCount(2);
    for (const link of await links.all()) await expect(link).toHaveAttribute('href', 'target.md#target');
    await expect(bare).toHaveCount(0);
    await expect(page.locator('#content')).toContainText('Read ./target.md.');
    await expect(page.locator('#content code')).toHaveText('./target.md');
  };
  await unchanged();
  await page.getByRole('searchbox').fill('links');
  await page.locator('#document-panel').evaluate(el => { el.scrollTop = 650; });
  await writeFile(path.join(root, '.env'), 'NOPAINMD_INDEX_MAX_NODES=1000');
  const indexing = Promise.withResolvers();
  const release = Promise.withResolvers();
  await page.route('**/api/index?*', async route => { indexing.resolve(); await release.promise; await route.continue(); });
  await page.locator('#reload').click(); await indexing.promise;
  try {
    await unchanged();
    await page.locator('#content').evaluate(el => { window.contentBeforeIndex = el.firstElementChild; });
  } finally { release.resolve(); }
  await expect(page.locator('#reload')).toBeEnabled();
  await expect(bare).toHaveCount(2);
  for (const link of await page.locator('#content a').all()) expect(new URL(await link.getAttribute('href'), base).searchParams.get('file')).toBe(target);
  expect(await page.locator('#content').evaluate(el => el.firstElementChild === window.contentBeforeIndex)).toBe(true);
  expect(await page.locator('#document-panel').evaluate(el => el.scrollTop)).toBe(650);
  await page.unroute('**/api/index?*');
  await rm(target);
  await reload(page);
  await unchanged();
  await writeFile(target, '# Target');
  await writeFile(path.join(root, '.env'), 'NOPAINMD_INDEX_MAX_NODES=1');
  await reload(page);
  await unchanged();
});

test('prose and Adjacent Skills code paths use the full tree without rewriting HTML, existing links, or code expressions', async ({ page }) => {
  const file = path.join(root, 'docs', 'nested', 'bare.md');
  const target = path.join(root, 'SKILL.md');
  await writeFile(target, '# Skill\n## Setup');
  const names = ['visualization-strategy-and-critique', 'data-visualization', 'node-link-and-diagram-layout', 'uml-and-software-architecture-visualization'];
  for (const name of names) {
    await mkdir(path.join(root, 'skills', name), { recursive: true });
    await writeFile(path.join(root, 'skills', name, 'SKILL.md'), `# ${name}`);
  }
  const paths = names.map(name => `../../skills/${name}/SKILL.md`);
  await writeFile(file, `# Bare paths
Read (../../SKILL.md#setup), then ../../plain.md.
Unknown ../../missing.md and ../../../outside/outside.md remain text.
Absolute ${target} remains text.
[../../SKILL.md](../../plain.md "Existing Markdown title")
<p title="../../SKILL.md">HTML prose: ../../SKILL.md</p>
<a href="../../plain.md" title="../../SKILL.md">Existing HTML ../../SKILL.md</a>

\`../../SKILL.md\`
\`\`\`md
../../SKILL.md
https://example.com/code
\`\`\`
## Adjacent Skills\n${paths.map(value => '- `' + value + '`').join('\n')}

\`../../missing/SKILL.md\`
\`open("../../skills/data-visualization/SKILL.md")\`
\`https://example.com/code\`

\`\`\`md
../../skills/data-visualization/SKILL.md
\`\`\`
`);
  await open(page, file);
  const auto = page.locator('#content > p').first().getByRole('link', { name: '../../SKILL.md#setup', exact: true });
  expect(new URL(await auto.getAttribute('href'), base).searchParams.get('file')).toBe(target);
  expect(new URL(await auto.getAttribute('href'), base).hash).toBe('#setup');
  await expect(auto).not.toHaveAttribute('target');
  await expect(page.locator('#content a a')).toHaveCount(0);
  await expect(page.locator('#content pre a')).toHaveCount(0);
  await expect(page.locator('#content p > code > a')).toHaveText('../../SKILL.md');
  await expect(page.locator('#content a[title="Existing Markdown title"]')).toHaveText('../../SKILL.md');
  await expect(page.locator('#content a[title="../../SKILL.md"]')).toHaveText('Existing HTML ../../SKILL.md');
  await expect(page.locator('#content p[title="../../SKILL.md"] a')).toHaveText('../../SKILL.md');
  for (const name of ['../../missing.md', '../../../outside/outside.md', target]) {
    await expect(page.locator('#content').getByRole('link', { name, exact: true })).toHaveCount(0);
  }
  const links = page.locator('#content ul code > a');
  await expect(links).toHaveText(paths);
  await expect(page.locator('#content p > code > a')).toHaveCount(1);
  for (let i = 0; i < names.length; i++) {
    expect(new URL(await links.nth(i).getAttribute('href'), base).searchParams.get('file')).toBe(path.join(root, 'skills', names[i], 'SKILL.md'));
  }
  const before = await page.locator('#content a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  await page.getByRole('searchbox').fill('bare');
  await expect(page.locator('.file-row')).toHaveText(['bare.md']);
  expect(await page.locator('#content a').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(before);
  await reload(page);
  await expect(links).toHaveCount(4);
  await auto.click(); await expect(page.locator('#reload')).toBeEnabled();
  await expect(page).toHaveTitle('Skill');
  expect(new URL(page.url()).hash).toBe('#setup');
  await page.goBack(); await expect(page.locator('#reload')).toBeEnabled();
  await links.nth(1).click(); await expect(page.locator('#reload')).toBeEnabled();
  await expect(page).toHaveTitle('data-visualization');
});

test('qualified prose URLs open a new tab after parsing without rewriting HTML attributes or authored links', async ({ page }) => {
  const file = path.join(root, 'urls.md');
  const urls = ['https://example.com/path_(detail)?a=1&b=2#heading', 'http://localhost:3000/', 'ftp://files.example.com/archive.zip', 'ftps://files.example.com/archive.zip', 'mailto:reader@example.com', 'tel:+14155552671'];
  const plain = ['example.com', 'www.example.com', 'reader@example.com', '//example.com/implicit', 'https://', 'https:/example.com', 'javascript:alert(1)', 'data:text/html,bad'];
  await writeFile(file, `# URL prose
${urls.map(url => `(${url}).`).join(' ')}

${plain.join(' ')}

<p title="https://example.com/attribute">HTML prose: https://example.com/html.</p>
<a href="https://example.com/existing" title="https://example.com/title">Authored https://example.com/label</a>

[Authored Markdown](https://example.com/markdown "Keep title")

\`https://example.com/inline\`

\`\`\`html
<a href="https://example.com/code">Example</a>
\`\`\`
`);
  await open(page, file);
  for (const url of [...urls, 'https://example.com/html']) {
    const link = page.locator('#content').getByRole('link', { name: url, exact: true });
    await expect(link).toHaveAttribute('href', url);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  for (const name of plain) await expect(page.locator('#content').getByRole('link', { name, exact: true })).toHaveCount(0);
  await expect(page.locator('#content a a, #content code a, #content pre a')).toHaveCount(0);
  await expect(page.locator('#content p[title]')).toHaveAttribute('title', 'https://example.com/attribute');
  await expect(page.locator('#content a[title="https://example.com/title"]')).toHaveText('Authored https://example.com/label');
  await expect(page.locator('#content a[title="Keep title"]')).toHaveText('Authored Markdown');
  const sourceURL = page.url();
  await page.context().route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Opened destination</p>' }));
  const popup = page.waitForEvent('popup');
  await page.getByRole('link', { name: urls[0], exact: true }).click();
  const tab = await popup;
  await tab.waitForLoadState();
  expect(tab.url()).toBe(urls[0]);
  expect(await tab.evaluate(() => window.opener === null)).toBe(true);
  expect(page.url()).toBe(sourceURL);
  await tab.close();
});

test('only-child directory chains expand automatically while manual collapses survive Reload', async ({ page }) => {
  await rm(path.join(root, 'docs'), { recursive: true });
  await rm(path.join(root, 'plain.md'));
  await mkdir(path.join(root, 'only', 'child'), { recursive: true });
  await mkdir(path.join(root, 'empty'));
  await writeFile(path.join(root, 'ignored.txt'), 'Not a tree entry');
  for (const name of ['a.md', 'b.md']) await writeFile(path.join(root, 'only', 'child', name), '# Document');
  await open(page);
  const only = page.getByRole('button', { name: 'only', exact: true });
  const child = page.getByRole('button', { name: 'child', exact: true });
  await expect(only).toHaveAttribute('aria-expanded', 'true');
  await expect(child).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.file-row')).toHaveCount(2);
  await expect(page.locator('.selected')).toHaveCount(0);
  await expect(page.locator('#content')).toHaveText('Select a Markdown file');
  await child.click();
  await reload(page);
  await expect(child).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.file-row')).toHaveCount(0);
  await only.click();
  await reload(page);
  await expect(only).toHaveAttribute('aria-expanded', 'false');
  await page.reload(); await expect(page.locator('#reload')).toBeEnabled();
  await expect(only).toHaveAttribute('aria-expanded', 'true');
  await expect(child).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.file-row')).toHaveCount(2);
});

test('collapsed descendants consume nodes, omitted paths and heading links do not', async ({ page }) => {
  await rm(path.join(root, 'docs'), { recursive: true });
  await rm(path.join(root, 'plain.md'));
  for (const folder of ['a', 'b']) {
    await mkdir(path.join(root, folder));
    for (const name of ['one.md', 'two.md']) await writeFile(path.join(root, folder, name), '# Title\n## Heading\n### Child');
  }
  await mkdir(path.join(root, 'empty', 'deeper'), { recursive: true });
  await writeFile(path.join(root, 'empty', 'deeper', 'notes.txt'), 'Not Markdown');
  await writeFile(path.join(root, '.env'), 'NOPAINMD_INDEX_MAX_NODES=6');
  await open(page);
  await expect(page.locator('.folder-row')).toHaveCount(2);
  await expect(page.locator('.file-row')).toHaveCount(0);
  await expect(page.locator('#notices')).toHaveText('');
  const expandAll = async () => {
    while (await page.locator('.folder-row[aria-expanded="false"]').count()) await page.locator('.folder-row[aria-expanded="false"]').first().click();
  };
  await expandAll();
  await expect(page.locator('.folder-row, .file-row')).toHaveCount(6);
  await page.locator('.file-row').first().click(); await expect(page.locator('#reload')).toBeEnabled();
  await expect(page.locator('.toc a')).toHaveCount(2);
  await expect(page.locator('.folder-row, .file-row')).toHaveCount(6);
  await expect(page.locator('#notices')).toHaveText('');
  await writeFile(path.join(root, '.env'), 'NOPAINMD_INDEX_MAX_NODES=5');
  await reload(page);
  await expandAll();
  await expect(page.locator('.folder-row, .file-row')).toHaveCount(5);
  const notice = 'May not load all files: the nodes limit hit. Increase NOPAINMD_INDEX_MAX_NODES to load more.';
  await expect(page.locator('#notices')).toHaveText(notice);
  expect(logs).toContain(notice);
  for (const folder of await page.locator('.folder-row').all()) await folder.click();
  await expect(page.locator('.file-row')).toHaveCount(0);
  await expect(page.locator('#notices')).toHaveText(notice);
});

test('Reload preserves expansion, scrolling, selection and applies live limits and font settings', async ({ page }) => {
  await open(page, docFile);
  await page.locator('.folder-row').filter({ hasText: 'nested' }).click();
  await page.locator('#document-panel').evaluate(el => { el.scrollTop = 650; });
  await writeFile(path.join(root, '.env'), 'NOPAINMD_INDEX_MAX_NODES=3\nNOPAINMD_FONT="Times New Roman"\nNOPAINMD_FONT_ZOOM=125');
  await reload(page);
  expect(await page.locator('#document-panel').evaluate(el => el.scrollTop)).toBe(650);
  await expect(page.locator('.selected')).toHaveText('guide & #.md');
  await expect(page.locator('#notices')).toContainText('NOPAINMD_INDEX_MAX_NODES');
  expect(await page.locator('#content').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Times New Roman');
  expect(await page.locator('#content').evaluate(el => getComputedStyle(el).fontSize)).toBe('20px');
  await writeFile(path.join(root, '.env'), 'NOPAINMD_INDEX_MAX_NODES=1000');
  await reload(page);
  await expect(page.locator('.folder-row').filter({ hasText: 'nested' })).toHaveAttribute('aria-expanded', 'true');
});

test('external navigation stays capped and pinned through search, Reload, timeout, and file removal', async ({ page }) => {
  const outside = path.join(external, 'outside.md');
  await writeFile(path.join(root, '.env'), 'NOPAINMD_INDEX_MAX_NODES=1');
  await writeFile(path.join(root, 'plain.md'), `[External](${viewerURL(outside)})`);
  await open(page, path.join(root, 'plain.md'));
  await page.locator('#content a').click(); await expect(page.locator('#reload')).toBeEnabled();
  await expect(page.locator('#tree .file-row, #tree .folder-row')).toHaveCount(1);
  await expect(page).toHaveTitle('Outside title');
  await expect(page.locator('#tree > ul > li').first()).toContainText('/**/outside.md');
  await expect(page.locator('#base-path')).toHaveText(root);
  await expect(page.locator('#content img')).toHaveJSProperty('naturalWidth', 40);
  await reload(page);
  await expect(page.locator('.file-row.selected')).toHaveText('/**/outside.md');
  const search = page.getByRole('searchbox', { name: 'Quick Search .md', exact: true });
  await search.fill('OUTSIDE');
  await expect(page.locator('.file-row')).toHaveText(['/**/outside.md']);
  await expect(page.locator('#notices')).toContainText('NOPAINMD_INDEX_MAX_NODES');
  await search.fill('/**/');
  await expect(page.locator('#tree')).toHaveText('No matching Markdown files.');
  await expect(page.locator('#notices')).toContainText('NOPAINMD_INDEX_MAX_NODES');
  await expect(page).toHaveTitle('Outside title');
  await search.fill('');
  await expect(page.locator('.file-row.selected')).toHaveText('/**/outside.md');
  await writeFile(path.join(root, '.env'), 'NOPAINMD_INDEX_MAX_MS=1\nNOPAINMD_INDEX_MAX_NODES=1');
  await reload(page);
  await expect(page.locator('#notices')).toContainText('NOPAINMD_INDEX_MAX_MS');
  await expect(page.locator('.selected')).toHaveText('/**/outside.md');
  await rm(outside);
  await reload(page);
  await expect(page.locator('#content')).toHaveText(`File not found${outside}`);
  await expect(page.locator('#print')).toBeHidden(); await expect(page.locator('.file-row.selected')).toHaveCount(0);
  const content = await page.locator('#content').boundingBox(); const message = await page.locator('#content > div').boundingBox();
  expect(Math.abs(message.y + message.height / 2 - content.y - content.height / 2)).toBeLessThan(2);
});

test('initial theme uses the browser preference before viewer startup unless a valid choice is saved', async ({ page }) => {
  await page.route('**/app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `window.themeBeforeViewer = document.documentElement.dataset.theme;\n${await response.text()}` });
  });
  await open(page);
  for (const [colorScheme, saved, expected] of [
    ['dark', null, 'dark'], ['light', null, 'light'],
    ['dark', 'light', 'light'], ['light', 'dark', 'dark'],
    ['dark', 'invalid', 'dark'],
  ]) {
    await page.emulateMedia({ colorScheme });
    await page.evaluate(saved => {
      if (saved === null) localStorage.removeItem('nopainmd.theme');
      else localStorage.setItem('nopainmd.theme', saved);
    }, saved);
    await page.reload();
    await expect(page.locator('#reload')).toBeEnabled();
    expect(await page.evaluate(() => window.themeBeforeViewer)).toBe(expected);
    await expect(page.locator('html')).toHaveAttribute('data-theme', expected);
    await expect(page.locator('#theme')).toHaveAttribute('aria-checked', String(expected === 'dark'));
    expect(await page.evaluate(() => localStorage.getItem('nopainmd.theme'))).toBe(saved);
  }
  await page.addInitScript(() => { window.matchMedia = undefined; });
  await page.evaluate(() => localStorage.removeItem('nopainmd.theme'));
  await page.reload();
  await expect(page.locator('#reload')).toBeEnabled();
  expect(await page.evaluate(() => window.themeBeforeViewer)).toBe('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('unavailable storage uses the browser theme and still permits switching and resizing', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage unavailable'); };
    Storage.prototype.setItem = () => { throw new Error('Storage unavailable'); };
  });
  await open(page, docFile);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#divider').focus(); await page.keyboard.press('ArrowRight');
  expect(Math.round((await page.locator('#sidebar').boundingBox()).width)).toBe(310);
  await page.locator('#html-toggle').click(); await expect(page.locator('#reload')).toBeEnabled();
  await expect(page.locator('#html-toggle')).toHaveAttribute('aria-checked', 'false');
  await reload(page);
  await expect(page.locator('#html-toggle')).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('HTML, theme, and width preferences persist within bounds; HTML toggles preserve state and override live defaults', async ({ page }) => {
  await writeFile(path.join(root, 'docs', 'picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18"/></svg>');
  await writeFile(docFile, '# Guide\n## Start\nUse <kbd>Ctrl</kbd> and H<sub>2</sub>O.\n\n<img src="picture.svg" alt="HTML image">\n\n![Markdown image](picture.svg)\n\n<!-- ![hidden](picture.svg) -->\n\n```mermaid\nflowchart LR\n A --> B\n```' + longText + '\n## End');
  await open(page, docFile);
  const toggle = page.getByRole('switch', { name: 'HTML', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#content kbd')).toHaveText('Ctrl');
  await expect(page.locator('#content img')).toHaveCount(2);
  await expect(page.locator('.mermaid-screen svg')).toHaveCount(1);
  expect(await page.locator('.html-indicator').evaluate(el => getComputedStyle(el).fill)).toBe('rgb(39, 148, 73)');
  expect(await page.evaluate(() => localStorage.getItem('nopainmd.html'))).toBeNull();
  await page.locator('.folder-row').filter({ hasText: 'nested' }).click();
  await page.locator('#document-panel').evaluate(el => { el.scrollTop = 650; });
  const before = logs.length;
  let documentRequests = 0;
  await page.route('**/api/document?*', route => { documentRequests++; return route.abort(); });
  await toggle.click(); await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(await page.locator('.html-indicator').evaluate(el => getComputedStyle(el).fill)).toBe('rgb(195, 66, 66)');
  await expect(page.locator('#content kbd')).toHaveCount(0);
  await expect(page.locator('#content')).toContainText('<kbd>Ctrl</kbd>');
  await expect(page.locator('#content img')).toHaveCount(1);
  await expect(page.getByAltText('Markdown image')).toHaveJSProperty('naturalWidth', 40);
  await expect(page.locator('#content')).toContainText('<img src="picture.svg" alt="HTML image">');
  await expect(page.locator('#content')).toContainText('<!-- ![hidden](picture.svg) -->');
  await expect(page.locator('.mermaid-screen svg')).toHaveCount(1);
  expect(await page.locator('#document-panel').evaluate(el => el.scrollTop)).toBe(650);
  await expect(page.locator('.selected')).toHaveText('guide & #.md');
  await expect(page.locator('.folder-row').filter({ hasText: 'nested' })).toHaveAttribute('aria-expanded', 'true');
  expect(logs.length).toBe(before);
  expect(documentRequests).toBe(0);
  await toggle.click(); await expect(toggle).toBeEnabled();
  await expect(page.locator('#content kbd')).toHaveText('Ctrl');
  await expect(page.locator('#content img')).toHaveCount(2);
  expect(await page.locator('#document-panel').evaluate(el => el.scrollTop)).toBe(650);
  expect(documentRequests).toBe(0);
  await toggle.click(); await expect(toggle).toBeEnabled();
  await page.unroute('**/api/document?*');
  expect(await page.evaluate(() => localStorage.getItem('nopainmd.html'))).toBe('false');
  await page.locator('#theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('nopainmd.theme'))).toBe('dark');
  await page.locator('#divider').focus(); await page.keyboard.press('End');
  expect(await page.evaluate(() => localStorage.getItem('nopainmd.sidebarWidth'))).toBe('1000');
  await page.reload(); await expect(toggle).toBeEnabled();
  await expect(page.locator('#content img')).toHaveCount(1);
  await expect(page.getByAltText('Markdown image')).toHaveJSProperty('naturalWidth', 40);
  await expect(page.locator('.mermaid-screen svg')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(Math.round((await page.locator('#sidebar').boundingBox()).width)).toBe(1000);
  await page.locator('#divider').focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowLeft');
  expect(Math.round((await page.locator('#sidebar').boundingBox()).width)).toBe(50);
  await expect(page.locator('#theme')).toBeVisible(); await page.locator('#theme').click();
  expect(await page.evaluate(() => localStorage.getItem('nopainmd.theme'))).toBe('light');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await writeFile(path.join(root, '.env'), 'NOPAINMD_HTML_ENABLED=true');
  await page.locator('#reload').click(); await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.evaluate(() => localStorage.removeItem('nopainmd.html'));
  await writeFile(path.join(root, '.env'), 'NOPAINMD_HTML_ENABLED=false');
  await page.reload(); await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await writeFile(path.join(root, '.env'), 'NOPAINMD_HTML_ENABLED=true');
  await page.locator('#reload').click(); await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#content kbd')).toHaveText('Ctrl');
  await page.locator('#divider').focus(); await page.keyboard.press('Home');
  await expect(toggle).toBeVisible();
  await expect(toggle.locator('span')).toHaveText('HTML');
  expect(await page.locator('footer').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
});

test('safe HTML and embedded SVG render, preserve local references, toggle immediately, and print', async ({ page }, testInfo) => {
  const file = path.join(external, 'html.markdown');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 480 180" width="480" height="180" style="display: block; background: #082846">
<title>Embedded drawing</title>

<defs>
  <linearGradient id="paint"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>
  <clipPath id="clip"><rect width="480" height="180"/></clipPath>
  <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10Z"/></marker>
  <path id="shape" d="M10 20H100V60H10Z"/>
</defs>

<rect width="480" height="180" fill="url(#paint)" clip-path="url(#clip)"/>
<path d="M10 90H200" style="stroke: green; stroke-width: 3; marker-end: url(#arrow)"/>
<use href="#shape" fill="yellow"/><use xlink:href="#shape" transform="translate(110 0)" fill="yellow"/>
<text x="10" y="150" fill="currentColor">../plain.md https://example.com/svg **literal**</text>
</svg>`;
  const figure = `<figure style="width: 2000px">\n  ${svg.replaceAll('\n', '\n    ')}\n  <figcaption>Embedded figure</figcaption>\n</figure>`;
  await writeFile(file, '<h4>HTML <em>title</em></h4>\n\n# Document\n## A <em>formatted</em><br>heading\n\n<details open><summary>More</summary><p>H<sub>2</sub>O and <kbd>Ctrl</kbd></p></details>\n\n<a href="../base/plain.md">Internal</a>\n<img src="picture.svg" alt="Picture">\n\n```html\n<script>example only</script>\n```\n\n' + figure + '\n\n' + svg + '\n\nInline <svg viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>.\n\n```svg\n<svg><text>Code only</text></svg>\n```' + longText);
  await open(page, file);
  await expect(page).toHaveTitle('HTML title');
  await expect(page.locator('.toc a')).toHaveText('A formatted heading');
  await expect(page.locator('#content h2')).toHaveAttribute('id', 'a-formatted-heading');
  await expect(page.locator('#content img')).toHaveJSProperty('naturalWidth', 40);
  expect(new URL(await page.locator('#content img').getAttribute('src'), base).searchParams.get('file')).toBe(path.join(external, 'picture.svg'));
  await expect(page.locator('#content details')).toHaveAttribute('open', '');
  await expect(page.locator('#content pre code').first()).toHaveText('<script>example only</script>\n');
  await expect(page.locator('#content pre')).toHaveCount(2);
  await expect(page.locator('#content pre svg')).toHaveCount(0);
  await expect(page.locator('#content figure > figcaption')).toHaveText('Embedded figure');
  await expect(page.locator('#content figure')).not.toHaveAttribute('style');
  const drawings = page.locator('#content .embedded-svg');
  await expect(drawings).toHaveCount(3);
  await expect(drawings.first().locator('text')).toHaveText('../plain.md https://example.com/svg **literal**');
  await expect(drawings.locator('a')).toHaveCount(0);
  await expect(drawings.first()).toHaveAttribute('viewBox', '0 0 480 180');
  await expect(drawings.first()).toHaveCSS('background-color', 'rgb(8, 40, 70)');
  await expect(drawings.first()).toHaveCSS('display', 'block');
  const referenceChecks = await drawings.evaluateAll(svgs => svgs.slice(0, 2).map(svg => {
    const ids = [...svg.querySelectorAll('[id]')].map(node => node.id);
    return {
      ids,
      fill: svg.querySelector('rect[fill]').getAttribute('fill'),
      clip: svg.querySelector('rect[fill]').getAttribute('clip-path'),
      hrefs: [...svg.querySelectorAll('use')].map(node => node.getAttribute('href') || node.getAttribute('xlink:href')),
      marker: svg.querySelector('path[style]').style.markerEnd,
      shapeWidth: svg.querySelector('use').getBBox().width,
    };
  }));
  expect(new Set(referenceChecks.flatMap(result => result.ids)).size).toBe(8);
  for (const result of referenceChecks) {
    expect(result.ids.every(id => id.startsWith('nopainmd-svg-'))).toBe(true);
    expect(result.fill).toBe(`url(#${result.ids[0]})`);
    expect(result.clip).toBe(`url(#${result.ids[1]})`);
    expect(result.marker).toContain(`#${result.ids[2]}`);
    expect(result.hrefs).toEqual([`#${result.ids[3]}`, `#${result.ids[3]}`]);
    expect(result.shapeWidth).toBe(90);
  }
  await drawings.first().screenshot({ path: testInfo.outputPath('embedded-svg.png') });
  await page.locator('#theme').click();
  await expect(drawings.first().locator('text')).toHaveCSS('fill', 'rgb(221, 221, 221)');
  await expect(drawings.first().locator('text')).toHaveCSS('font-family', await page.locator('#content').evaluate(el => getComputedStyle(el).fontFamily));
  await page.locator('#document-panel').evaluate(el => { el.scrollTop = 650; });
  for (const enabled of [false, true]) {
    await page.locator('#html-toggle').click();
    await expect(page.locator('#html-toggle')).toBeEnabled();
    await expect(drawings).toHaveCount(enabled ? 3 : 0);
    if (!enabled) await expect(page.locator('#content')).toContainText('<svg');
    expect(await page.locator('#document-panel').evaluate(el => el.scrollTop)).toBe(650);
  }
  await page.locator('#divider').focus(); await page.keyboard.press('End');
  expect((await drawings.first().boundingBox()).width).toBeLessThan(480);
  await page.locator('#divider').focus(); await page.keyboard.press('Home');
  await page.locator('.toc a').click();
  expect(new URL(page.url()).hash).toBe('#a-formatted-heading');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#content kbd')).toBeVisible();
  await expect(page.locator('#html-toggle')).toBeHidden();
  await expect(drawings.first()).toBeVisible();
  await page.pdf({ path: testInfo.outputPath('html.pdf') });
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('link', { name: 'Internal', exact: true }).click();
  await expect(page).toHaveTitle('plain.md');
});

test('HTML sanitization blocks executable markup and UI impersonation even without CSP', async ({ browser }) => {
  const file = path.join(external, 'unsafe.md');
  await writeFile(file, `# Safe <em>title</em>
<script>window.htmlAttack = true</script>
<style>body { display: none }</style>
<iframe srcdoc="<script>parent.htmlAttack=true</script>"></iframe>
<svg id="content" viewBox="0 0 40 40" width="40" height="40" style="position:fixed; inset:0; background:url(https://example.com/attack); fill:red">
<script>window.htmlAttack=true</script><style>body { display: none }</style>
<foreignObject><iframe srcdoc="<script>parent.htmlAttack=true</script>"></iframe></foreignObject>
<image href="https://example.com/attack"/>
<use href="https://example.com/attack#shape"/><use href="#sidebar"/><use href="#theme"/>
<a href="javascript:window.htmlAttack=true"><text>SVG unsafe link</text></a>
<rect id="theme" width="20" height="20" onload="window.htmlAttack=true" fill="url(https://example.com/attack)" style="stroke: url(https://example.com/attack); font-family: Evil; position: fixed; stroke-width: 2"/>
<circle cx="20" cy="20" r="5" fill="red"><animate attributeName="fill" to="url(https://example.com/attack)"/><set attributeName="onload" to="window.htmlAttack=true"/></circle>
</svg>
<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=window.htmlAttack=true>"></table></mtext></math>
<form id="content"><input name="DOMPurify" type="text"></form>
<div id="theme" class="selected mermaid-block" style="position:fixed" data-nopainmd="forged"><pre>forged diagram</pre></div>
<a href="javascript:window.htmlAttack=true" onclick="window.htmlAttack=true">Unsafe link</a>
<a href="jav&#x09;ascript:window.htmlAttack=true">Obfuscated link</a>
<img src="picture.svg" onload="window.htmlAttack=true" alt="Safe image">
<img src="data:image/svg+xml,<svg onload='window.htmlAttack=true'></svg>" alt="Blocked data">

## Theme

- [x] Read-only task

\`\`\`mermaid
flowchart LR
 A[Safe] --> B[Diagram]
\`\`\`
`);
  const context = await browser.newContext({ bypassCSP: true });
  try {
    const page = await context.newPage();
    const remote = [];
    await page.route('https://example.com/**', route => { remote.push(route.request().url()); return route.abort(); });
    await open(page, file);
    await expect(page).toHaveTitle('Safe title');
    await expect(page.locator('#content script, #content style:not(.mermaid-block style), #content iframe, #content foreignObject:not(.mermaid-block foreignObject), #content animate, #content set, #content math, #content form')).toHaveCount(0);
    const svg = page.locator('#content .embedded-svg');
    await expect(svg).toHaveCount(1);
    await expect(svg).toHaveCSS('position', 'static');
    await expect(svg).toHaveCSS('fill', 'rgb(255, 0, 0)');
    await expect(svg).toHaveCSS('background-image', 'none');
    await expect(svg.locator('rect')).not.toHaveAttribute('fill');
    await expect(svg.locator('rect')).toHaveAttribute('style', 'stroke-width: 2;');
    await expect(svg.locator('image, a[href], use[href^="http"]')).toHaveCount(0);
    await expect(svg.locator('use').first()).not.toHaveAttribute('href');
    await expect(svg.locator('use').nth(1)).not.toHaveAttribute('href');
    await expect(svg.locator('use').nth(2)).toHaveAttribute('href', `#${await svg.locator('rect').getAttribute('id')}`);
    expect(remote).toEqual([]);
    expect(await page.evaluate(() => window.htmlAttack)).toBeUndefined();
    expect(await page.locator('#content').evaluate(el => [...el.querySelectorAll('*')].some(node => [...node.attributes].some(attr => /^on/iu.test(attr.name))))).toBe(false);
    await expect(page.locator('#content .selected, #content #content, #content [name], #content [data-nopainmd]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Unsafe link' })).toHaveCount(0);
    await expect(page.locator('#content a').filter({ hasText: 'Obfuscated link' })).not.toHaveAttribute('href');
    await expect(page.getByAltText('Safe image')).toHaveJSProperty('naturalWidth', 40);
    await expect(page.getByAltText('Blocked data')).not.toHaveAttribute('src');
    await expect(page.locator('#content input')).toHaveCount(1);
    await expect(page.locator('#content input')).toBeDisabled();
    await expect(page.locator('.mermaid-screen svg')).toHaveCount(1);
    await expect(page.locator('.mermaid-block')).toHaveCount(1);
    await page.locator('.toc a').click();
    expect(new URL(page.url()).hash).toBe('#theme');
    await page.locator('#html-toggle').click(); await expect(page.locator('#reload')).toBeEnabled();
    await expect(page.locator('#content')).toContainText('<script>window.htmlAttack = true</script>');
    await expect(page.locator('.mermaid-screen svg')).toHaveCount(1);
    expect(await page.evaluate(() => window.htmlAttack)).toBeUndefined();
  } finally { await context.close(); }
});

test('HTML resource URLs preserve Windows paths and reject executable or unsupported schemes', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const { resourceURL, prepareDocument } = await import('/document.js');
    const doc = { sourceURL: 'file:///C:/docs/readme.md', separator: '\\', imageToken: 'test' };
    const convert = (value, document, paths) => {
      const rendered = prepareDocument({ ...document, html: `<a href="${value}">Link</a>` });
      rendered.updateLinks(new Map(paths.map(path => [path, { path, type: 'file' }])));
      return rendered.fragment.querySelector('a').getAttribute('href');
    };
    return {
      link: convert('nested/my%20file.MARKDOWN#section', doc, ['C:\\docs\\nested\\my file.MARKDOWN']),
      insensitive: convert('NESTED/MY%20FILE.markdown', doc, ['C:\\docs\\nested\\my file.MARKDOWN']),
      backslashes: convert('nested\\my%20file.MARKDOWN#section', doc, ['C:\\docs\\nested\\my file.MARKDOWN']),
      missing: convert('nested/not-indexed.md', doc, ['C:\\docs\\nested\\my file.MARKDOWN']),
      absolute: resourceURL('D:\\outside\\file.md', doc),
      image: resourceURL('../images/picture.png', doc, true),
      unc: convert('other.md', { ...doc, sourceURL: 'file://fileserver/share/readme.md' }, ['\\\\fileserver\\share\\other.md']),
      bad: ['javascript:alert(1)', 'jav\tascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'gopher://example.com/file'].map(value => resourceURL(value, doc)),
    };
  });
  expect(new URL(result.link, base).searchParams.get('file')).toBe('C:\\docs\\nested\\my file.MARKDOWN');
  expect(new URL(result.insensitive, base).searchParams.get('file')).toBe('C:\\docs\\nested\\my file.MARKDOWN');
  expect(new URL(result.backslashes, base).searchParams.get('file')).toBe('C:\\docs\\nested\\my file.MARKDOWN');
  expect(result.missing).toBe('nested/not-indexed.md');
  expect(result.absolute).toBe('D:\\outside\\file.md');
  expect(new URL(result.image, base).searchParams.get('file')).toBe('C:\\images\\picture.png');
  expect(new URL(result.unc, base).searchParams.get('file')).toBe('\\\\fileserver\\share\\other.md');
  expect(result.bad).toEqual([null, null, null, null]);
});

test('a slow previous document cannot replace a newer navigation', async ({ page }) => {
  const slow = path.join(root, 'slow.md');
  await writeFile(slow, '# Slow');
  await open(page, docFile);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/document?*', async route => {
    if (new URL(route.request().url()).searchParams.get('file') !== slow) return route.continue();
    await held;
    await route.fulfill({ json: { path: slow, name: 'slow.md', parent: root, external: false, html: '<h1>Slow</h1>', title: 'Slow', headings: [] } }).catch(() => {});
  });
  await page.getByRole('link', { name: 'slow.md', exact: true }).click();
  await page.getByRole('link', { name: 'plain.md', exact: true }).click();
  await expect(page).toHaveTitle('plain.md');
  release();
  await expect(page.locator('#content')).toHaveText('A plain document.');
  await expect(page.locator('.selected')).toHaveText('plain.md');
});

test('Mermaid renders locally, follows themes, handles invalid source, and prints completed SVGs', async ({ page }, testInfo) => {
  const file = path.join(root, 'diagrams.md');
  await writeFile(file, '# Diagrams\n```mermaid\nflowchart LR\n A[Start] --> B[End]\n```\n```mermaid\nsequenceDiagram\n Alice->>Bob: Hello\n```\n```mermaid\ninvalid diagram syntax\n```');
  const remote = []; page.on('request', req => { if (!req.url().startsWith(base)) remote.push(req.url()); });
  await open(page, file);
  await expect(page.locator('.mermaid-screen svg')).toHaveCount(2);
  await expect(page.locator('.mermaid-print svg')).toHaveCount(2);
  await expect(page.locator('.mermaid-error')).toHaveCount(1);
  await expect(page.locator('#print')).toBeEnabled();
  const light = await page.locator('.mermaid-screen').first().innerHTML();
  const label = page.locator('.mermaid-screen').nth(1).locator('.messageText').first();
  const labelSize = parseFloat(await label.evaluate(el => getComputedStyle(el).fontSize));
  await writeFile(path.join(root, '.env'), 'NOPAINMD_FONT_ZOOM=150\nNOPAINMD_FONT="Times New Roman"');
  await reload(page);
  expect(parseFloat(await label.evaluate(el => getComputedStyle(el).fontSize))).toBeCloseTo(labelSize * 1.5, 1);
  expect(await label.evaluate(el => getComputedStyle(el).fontFamily)).toContain('Times New Roman');
  await page.screenshot({ path: testInfo.outputPath('light.png') });
  await page.locator('#theme').click(); await expect(page.locator('#print')).toBeEnabled();
  expect(await page.locator('.mermaid-screen').first().innerHTML()).not.toBe(light);
  await page.screenshot({ path: testInfo.outputPath('dark.png') });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#sidebar')).toBeHidden(); await expect(page.locator('#print')).toBeHidden();
  await expect(page.locator('.mermaid-print').first()).toBeVisible();
  await page.pdf({ path: testInfo.outputPath('document.pdf'), format: 'A4', printBackground: true });
  expect(await page.evaluate(() => localStorage.getItem('nopainmd.theme'))).toBe('dark');
  expect(remote).toEqual([]);
});

test('imported viewers isolate their UI, support custom data and history, and clean up pending work', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const file = path.join(root, 'embedded.md');
  await writeFile(path.join(root, 'picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18"/></svg>');
  await writeFile(file, '# Embedded\n## Links\n[Plain](plain.md)\n<kbd>HTML</kbd>\n![picture](picture.svg)\n```mermaid\nflowchart LR\n A-->B\n```');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/host?*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Host application</title><style>body{margin:20px}button{color:rgb(190,0,0)}article{display:none}.slot{height:550px;width:650px;display:inline-block}</style><button id="host-button">Host action</button><div id="one" class="slot"></div><div id="two" class="slot"></div>' }));
  await page.goto(`${base}/host?section=docs`);
  const initial = await page.evaluate(async ({ file, base }) => {
    const before = document.documentElement.outerHTML;
    const { mountNoPainMD, createHTTPSource } = await import('/viewer.js');
    const unchanged = before === document.documentElement.outerHTML;
    const source = createHTTPSource({ baseURL: `${base}/api/` });
    localStorage.setItem('nopainmd.theme', 'light');
    localStorage.setItem('first.theme', 'light');
    localStorage.setItem('second.theme', 'light');
    const one = mountNoPainMD(document.querySelector('#one'), { file, source, storageKey: 'first', onNavigate: (file, hash) => { window.lastNavigation = { file, hash }; } });
    const two = mountNoPainMD(document.querySelector('#two'), { file, source, storageKey: 'second', theme: 'dark' });
    window.embedded = { one, two, mountNoPainMD, source };
    await Promise.all([one.ready, two.ready]);
    return { unchanged, fonts: document.fonts.check('16px "Open Sans"') };
  }, { file, base });
  expect(initial).toEqual({ unchanged: true, fonts: true });
  const one = page.locator('#one'); const two = page.locator('#two');
  await expect(one.locator('#content')).toBeVisible();
  expect(await one.locator('#content img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(one.locator('.mermaid-screen svg')).toHaveCount(1);
  await expect(two.locator('.mermaid-screen svg')).toHaveCount(1);
  expect(await one.locator('.mermaid-screen svg').getAttribute('id')).not.toBe(await two.locator('.mermaid-screen svg').getAttribute('id'));
  await expect(one.locator('#sidebar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(two.locator('#sidebar')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(page.locator('#host-button')).toHaveCSS('color', 'rgb(190, 0, 0)');
  await expect(one.locator('#print')).toHaveCSS('position', 'fixed');
  const bounds = await one.boundingBox(); const print = await one.locator('#print').boundingBox();
  expect(print.x).toBeGreaterThan(bounds.x); expect(print.x + print.width).toBeLessThan(bounds.x + bounds.width);
  await page.evaluate(() => {
    const append = document.body.append;
    document.body.append = function (...nodes) {
      append.apply(this, nodes);
      for (const frame of nodes.filter(node => node instanceof HTMLIFrameElement)) {
        frame.contentWindow.print = () => {
          window.printed = { text: frame.contentDocument.body.textContent, sidebar: !!frame.contentDocument.querySelector('#sidebar'), diagrams: frame.contentDocument.querySelectorAll('.mermaid-print svg').length };
          frame.contentWindow.dispatchEvent(new Event('afterprint'));
          document.body.append = append;
        };
      }
    };
  });
  await one.locator('#print').click();
  await expect.poll(() => page.evaluate(() => window.printed?.diagrams)).toBe(1);
  const printed = await page.evaluate(() => window.printed);
  expect(printed.sidebar).toBe(false);
  expect(printed.text).toContain('Embedded'); expect(printed.text).not.toContain('Host action');
  await expect(page.locator('iframe')).toHaveCount(0);
  await one.locator('#html-toggle').click();
  await expect(one.locator('#content kbd')).toHaveCount(0);
  await expect(two.locator('#content kbd')).toHaveCount(1);
  await one.locator('#quick-search').fill('embedded');
  await one.locator('#content').getByRole('link', { name: 'Plain', exact: true }).click();
  await expect(one.locator('#content')).toHaveText('A plain document.');
  await expect(two.locator('#content h1')).toHaveText('Embedded');
  expect(await page.evaluate(() => window.lastNavigation.file)).toBe(path.join(root, 'plain.md'));
  expect(page.url()).toBe(`${base}/host?section=docs`);
  await expect(page).toHaveTitle('Host application');
  await page.evaluate(async () => {
    const { one, two } = window.embedded;
    await Promise.all([one.setTheme('dark'), two.setTheme('light')]);
  });
  await page.screenshot({ path: testInfo.outputPath('embedded.png') });
  const teardown = await page.evaluate(async () => {
    const { one, two, mountNoPainMD, source } = window.embedded;
    const container = document.querySelector('#one');
    one.destroy(); one.destroy();
    const empty = container.childElementCount === 0;
    let aborted = false;
    const pending = mountNoPainMD(container, { source: { ...source, getConfig: signal => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); })) } });
    pending.destroy(); await pending.ready;
    two.destroy();
    const fontsReleased = [...document.fonts].filter(face => face.family === 'Open Sans').length === 0;
    const early = mountNoPainMD(container, { source, storageKey: false });
    const browserTheme = early.element.dataset.theme;
    await early.open(window.lastNavigation.file);
    const indexedAfterEarlyOpen = early.element.querySelectorAll('.file-row').length;
    early.destroy();
    const historyViewer = mountNoPainMD(container, { source, history: true, updateTitle: true, storageKey: false, theme: 'light' });
    await historyViewer.ready;
    window.embedded.historyViewer = historyViewer;
    return { empty, aborted, fontsReleased, indexedAfterEarlyOpen, browserTheme, explicitTheme: historyViewer.element.dataset.theme };
  });
  expect(teardown).toEqual({ empty: true, aborted: true, fontsReleased: true, indexedAfterEarlyOpen: 2, browserTheme: 'dark', explicitTheme: 'light' });
  await page.evaluate(file => window.embedded.historyViewer.open(file, '#links'), file);
  await expect(page).toHaveTitle('Embedded');
  expect(new URL(page.url()).searchParams.get('section')).toBe('docs');
  expect(new URL(page.url()).searchParams.get('file')).toBe(file);
  await page.evaluate(() => window.embedded.historyViewer.destroy());
  expect(errors).toEqual([]);
});
