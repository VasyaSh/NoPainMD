import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'nopainmd-package-'));
const prefix = path.join(temporary, 'global');
const docs = path.join(temporary, 'documents');
const launch = path.join(temporary, 'launcher');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let child;
let processGroup = false;
try {
  await mkdir(docs);
  await mkdir(launch);
  await writeFile(path.join(docs, 'readme.MARKDOWN'), '# Installed package\n## Works\nUse <kbd>Ctrl</kbd>.\n\n<svg viewBox="0 0 40 40">\n\n<circle cx="20" cy="20" r="18"/>\n</svg>\n\n```mermaid\nflowchart LR\n A-->B\n```');
  await exec(npm, ['pack', '--pack-destination', temporary, '--silent'], { cwd: root });
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  await exec(npm, ['install', '-g', '--prefix', prefix, path.join(temporary, `${metadata.name}-${metadata.version}.tgz`), '--no-audit', '--no-fund'], { timeout: 120000 });
  const consumer = path.join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'viewer-consumer', private: true, type: 'module' }));
  await exec(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', path.join(temporary, `${metadata.name}-${metadata.version}.tgz`)], { cwd: consumer, timeout: 120000 });
  await writeFile(path.join(consumer, 'viewer.ts'), `
import { mountNoPainMD, createHTTPSource, type ViewerDataSource, type NoPainMDViewer, type MarkdownDocument, type TreeNode, type IndexResult } from 'nopainmd';
export function mount(container: HTMLElement): NoPainMDViewer {
  const source: ViewerDataSource = createHTTPSource({ baseURL: '/docs-api/' });
  return mountNoPainMD(container, { source, storageKey: 'host.docs', onDocumentChange(document: MarkdownDocument | null) { console.log(document?.title); } });
}
export function files(result: IndexResult): TreeNode[] { return result.nodes.filter(node => node.type === 'file'); }
// @ts-expect-error Invalid theme choices must be rejected by the published types.
mountNoPainMD(document.body, { theme: 'invalid-theme' });
`);
  for (const mode of ['NodeNext', 'Bundler']) {
    await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: false, target: 'ES2022', lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: [], module: mode === 'NodeNext' ? mode : 'ESNext', moduleResolution: mode }, files: ['viewer.ts'] }));
    await exec(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', consumer], { cwd: consumer });
  }
  await build({ absWorkingDir: consumer, entryPoints: ['viewer.ts'], outdir: 'build', bundle: true, splitting: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  await writeFile(path.join(consumer, 'import.mjs'), "import { mountNoPainMD } from 'nopainmd'; import { createApp } from 'nopainmd/server'; if (typeof mountNoPainMD !== 'function' || typeof createApp !== 'function') throw new Error('Missing module exports');");
  await exec(process.execPath, ['import.mjs'], { cwd: consumer });
  for (const developmentDependency of ['typescript', 'eslint', '@playwright/test', 'mermaid', 'dompurify']) {
    await assert.rejects(readFile(path.join(consumer, 'node_modules', developmentDependency, 'package.json')));
  }
  console.log('module: browser bundling, strict consumer declarations, side-effect-free imports, and production dependencies passed.');
  const bin = process.platform === 'win32' ? path.join(prefix, 'node_modules/nopainmd/dist/bin/nopainmd.js') : path.join(prefix, 'bin/nopainmd');
  assert.equal((await exec(process.execPath, [bin, '--version'])).stdout.trim(), metadata.version);
  for (const mode of ['global', 'npx']) {
    const tarball = path.join(temporary, `${metadata.name}-${metadata.version}.tgz`);
    const args = ['--host', '127.0.0.1', '--port', '0', '--no-open'];
    processGroup = mode === 'npx' && process.platform !== 'win32';
    const cwd = mode === 'global' ? docs : launch;
    const env = { ...process.env, NOPAINMD_BASE_DIR: mode === 'global' ? '.' : docs };
    child = mode === 'global'
      ? spawn(process.execPath, [bin, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', `--package=${tarball}`, 'nopainmd', ...args], { cwd, env, detached: processGroup, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${mode} startup timed out: ${errors}`)), 60000);
      child.stdout.on('data', () => {
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', code => { clearTimeout(timer); reject(new Error(`Installed CLI exited (${code})`)); });
    });
    assert.match(output, /Press Ctrl\+C to exit/);
    const config = await (await fetch(`${url}api/config`)).json();
    assert.equal(config.root, docs);
    assert.equal(config.htmlEnabled, true);
    const result = await (await fetch(`${url}api/index`)).json();
    assert.equal(result.nodes.length, 1);
    assert.equal(result.filesFound, 1); assert.equal(result.readErrors, 0);
    await fetch(`${url}api/document?${new URLSearchParams({ file: path.join(docs, 'missing.md') })}`);
    const reindex = await (await fetch(`${url}api/index`)).json();
    assert.equal(reindex.filesFound, 1); assert.equal(reindex.readErrors, 1);
    const doc = await (await fetch(`${url}api/document?${new URLSearchParams({ file: path.join(docs, 'readme.MARKDOWN') })}`)).json();
    assert.equal(doc.title, 'Installed package');
    assert.match(doc.html, /<kbd>Ctrl<\/kbd>/);
    assert.match(doc.html, /<svg viewBox="0 0 40 40">\n\n<circle/);
    const escaped = await (await fetch(`${url}api/document?${new URLSearchParams({ file: path.join(docs, 'readme.MARKDOWN'), html: 'false' })}`)).json();
    assert.match(escaped.html, /&lt;kbd&gt;.*Ctrl.*&lt;\/kbd&gt;/);
    assert.doesNotMatch(escaped.html, /<svg/);
    for (const asset of ['app.js', 'viewer.js', 'document.js', 'preferences.js', 'style.css', 'favicon.png', 'fonts/OpenSans-Regular.ttf', 'fonts/LICENSE.txt', 'vendor/mermaid/LICENSE', 'vendor/dompurify/LICENSE']) {
      const response = await fetch(url + asset); assert.equal(response.status, 200, asset);
    }
    const favicon = Buffer.from(await (await fetch(`${url}favicon.png`)).arrayBuffer());
    assert.equal(favicon.readUInt32BE(16), 96); assert.equal(favicon.readUInt32BE(20), 96);
    await writeFile(path.join(docs, 'other.md'), '# Other');
    await writeFile(path.join(cwd, '.env'), 'NOPAINMD_INDEX_MAX_NODES=1');
    const limited = await (await fetch(`${url}api/index`)).json();
    assert.equal(limited.nodes.length, 1); assert.deepEqual(limited.limits, ['nodes']);
    await rm(path.join(docs, 'other.md')); await rm(path.join(cwd, '.env'));
    const stopped = once(child, 'exit');
    if (processGroup) process.kill(-child.pid, 'SIGINT'); else child.kill('SIGINT');
    await stopped;
    assert.ok(child.exitCode === 0 || (mode === 'npx' && (child.exitCode === 130 || child.signalCode === 'SIGINT')));
    await assert.rejects(fetch(`${url}api/config`));
    assert.equal((output.match(/Found 1 Markdown files in /gu) || []).length, 2);
    assert.match(output, /; 0 read errors/); assert.match(output, /; 1 read error\./);
    assert.ok(output.includes('May not load all files: the nodes limit hit. Increase NOPAINMD_INDEX_MAX_NODES to load more.'));
    assert.doesNotMatch(output, /partial index/iu);
    assert.doesNotMatch(output + errors, /ENOENT|EACCES|Error:|missing\.md/);
    console.log(`${mode}: startup, indexing summaries, read-error recovery, assets, and Ctrl+C shutdown passed.`);
  }
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    if (processGroup) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL');
  }
  await rm(temporary, { recursive: true, force: true });
}
