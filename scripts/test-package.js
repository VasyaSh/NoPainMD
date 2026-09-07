import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

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
  const bin = process.platform === 'win32' ? path.join(prefix, 'node_modules/nopainmd/bin/nopainmd.js') : path.join(prefix, 'bin/nopainmd');
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
    assert.match(escaped.html, /&lt;kbd&gt;Ctrl&lt;\/kbd&gt;/);
    assert.doesNotMatch(escaped.html, /<svg/);
    for (const asset of ['app.js', 'document.js', 'svg.js', 'text-links.js', 'headings.js', 'limits.js', 'tree-nodes.js', 'style.css', 'favicon.png', 'fonts/OpenSans-Regular.ttf', 'fonts/LICENSE.txt', 'vendor/mermaid/mermaid.esm.min.mjs', 'vendor/dompurify/purify.min.js', 'vendor/dompurify/LICENSE']) {
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
