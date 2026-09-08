import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scanDirectory } from '../dist/src/scan.js';
import { createApp } from '../dist/src/server.js';
import { createConfig } from '../dist/src/config.js';
import { indexDirectory } from '../dist/src/indexer.js';
import { readSafely, ReadError, cliError } from '../dist/src/read-errors.js';

const fault = code => Object.assign(new Error(`RAW ${code} /private/path stack must not be shown`), { code });
const entry = (name, directory = false) => ({ name, isDirectory: () => directory, isFile: () => !directory, isSymbolicLink: () => false });

test('arbitrary open, read, and close failures are counted and healthy siblings survive', () => {
  const root = path.resolve('/fake');
  const events = [];
  let rootIndex = 0;
  const entries = [entry('denied', true), entry('io-error', true), entry('gone', true), entry('close-error', true), entry('ok.md')];
  const io = {
    opendirSync(dir) {
      const name = path.basename(dir);
      if (name === 'denied') throw fault('EACCES');
      if (name === 'gone') throw fault('ENOENT');
      if (name === 'io-error') return { readSync() { throw fault('EIO'); }, closeSync() { throw fault('EBADF'); } };
      if (name === 'close-error') return { readSync() { return null; }, closeSync() { throw fault('EIO'); } };
      return { readSync() { return entries[rootIndex++] || null; }, closeSync() {} };
    },
  };
  assert.doesNotThrow(() => scanDirectory({ root, maxNodes: 1000, deadline: Date.now() + 5000 }, (type, value) => events.push({ type, value }), io));
  assert.equal(events.filter(e => e.type === 'readError').length, 5);
  assert.ok(events.some(e => e.type === 'nodes' && e.value.some(node => node.name === 'ok.md')));
  assert.equal(events.some(e => e.type === 'complete' && e.value === root), false);
  assert.doesNotMatch(JSON.stringify(events), /RAW|EACCES|ENOENT|EBADF|EIO|private/);
  events.length = 0;
  let closed = false;
  scanDirectory({ root, maxNodes: 1000, deadline: 0 }, (type, value) => events.push({ type, value }), {
    opendirSync() { return { readSync() { assert.fail('Expired scans must not read entries'); }, closeSync() { closed = true; } }; },
  });
  assert.ok(closed);
  assert.deepEqual(events.filter(event => event.type === 'limit'), [{ type: 'limit', value: 'time' }]);
  assert.equal(events.some(event => event.type === 'complete' || event.type === 'nodes'), false);
});

test('read wrappers sanitize all native and nonstandard thrown values', async () => {
  for (const value of [fault('EIO'), fault('EMFILE'), fault('EACCES'), fault('ENOENT'), new Error('RAW custom'), null, 'RAW string']) {
    await assert.rejects(readSafely(() => { throw value; }), error => error instanceof ReadError && !/RAW|private/.test(error.message));
  }
  for (const [code, status] of [['ENOENT', 404], ['ENOTDIR', 404], ['EACCES', 403], ['EPERM', 403], ['EIO', 500]]) {
    const error = new ReadError(fault(code));
    assert.equal(error.status, status);
    assert.equal(cliError(error), error.message);
    assert.doesNotMatch(cliError(Object.assign(fault(code), { syscall: 'read' })), /RAW|private/);
  }
  assert.doesNotMatch(cliError(fault('ERR_FS_FILE_TOO_LARGE')), /RAW|private/);
  assert.equal(await readSafely(() => Promise.resolve('content')), 'content');
});

test('worker crashes and unexpected exits preserve selection, report sanitized errors, and allow recovery', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nopainmd-worker-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const selected = path.join(root, 'selected.md');
  await writeFile(selected, '# Selected');
  const preload = path.join(root, 'worker-failure.mjs');
  await writeFile(preload, `
import { isMainThread } from 'node:worker_threads';
if (!isMainThread) {
  if (process.env.TEST_WORKER_FAILURE === 'error') throw new Error('RAW worker crash /private/path');
  if (process.env.TEST_WORKER_FAILURE === 'exit') process.exit(1);
}
`);
  const script = path.join(root, 'check.mjs');
  await writeFile(script, `
import assert from 'node:assert/strict';
import { indexDirectory } from ${JSON.stringify(new URL('../dist/src/indexer.js', import.meta.url).href)};
const options = ${JSON.stringify({ root, selected })};
for (const mode of ['error', 'exit']) {
  process.env.TEST_WORKER_FAILURE = mode;
  const result = await indexDirectory(options);
  assert.equal(result.readErrors, 1);
  assert.equal(result.partial, true);
  assert.deepEqual(result.limits, []);
  assert.equal(result.filesFound, 1);
  assert.deepEqual(result.nodes.map(node => node.path), [options.selected]);
  assert.deepEqual(result.warnings, ['1 read error occurred. Some paths could not be read.']);
  assert.doesNotMatch(JSON.stringify(result), /RAW|private|stack/);
}
delete process.env.TEST_WORKER_FAILURE;
const recovered = await indexDirectory(options);
assert.equal(recovered.readErrors, 0);
assert.equal(recovered.partial, false);
assert.deepEqual(recovered.warnings, []);
assert.ok(recovered.completeDirectories.includes(options.root));
`);
  const { stderr } = await promisify(execFile)(process.execPath, ['--import', preload, script], {
    env: { ...process.env, NODE_DEBUG: '' }, timeout: 15000,
  });
  assert.equal(stderr, '');
});

test('Node diagnostics log read failures only when enabled and keep API responses sanitized', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'nopainmd-diagnostics-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const modules = new URL('../dist/src/', import.meta.url);
  const script = path.join(temporary, 'check.mjs');
  await writeFile(script, `
import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { createApp } from ${JSON.stringify(new URL('server.js', modules).href)};
import { createConfig } from ${JSON.stringify(new URL('config.js', modules).href)};
import { readSafely, ReadError } from ${JSON.stringify(new URL('read-errors.js', modules).href)};
import { scanDirectory } from ${JSON.stringify(new URL('scan.js', modules).href)};
const root = ${JSON.stringify(path.join(temporary, 'missing'))};
const readConfig = createConfig(${JSON.stringify(temporary)}, {}, {});
assert.equal((await readConfig()).readErrors, 0);
const app = await createApp({ root, readConfig });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
try {
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const missing = await fetch(base + '/api/document?' + new URLSearchParams({ file: root + '/absent.md' }));
  assert.deepEqual(await missing.json(), { error: 'File not found' });
  await mkdir(${JSON.stringify(path.join(temporary, '.env'))});
  const response = await fetch(base + '/api/index');
  const result = await response.json();
  assert.equal(result.readErrors, 4);
  assert.doesNotMatch(JSON.stringify(result), /ENOENT|EISDIR|RAW/);
  const unknown = new Error('RAW failure\\nwith newline');
  for (const error of [unknown, 'RAW string', null]) {
    await assert.rejects(readSafely(() => { throw error; }, { operation: 'injected', path: root }), ReadError);
  }
  scanDirectory({ root, maxNodes: 100, deadline: Date.now() + 5000 }, () => {}, {
    opendirSync() { return {
      readSync() { throw Object.assign(new Error('injected read failure'), { code: 'EIO' }); },
      closeSync() { throw Object.assign(new Error('injected close failure'), { code: 'EBADF' }); },
    }; },
  });
} finally { await app.stop(); await rm(${JSON.stringify(path.join(temporary, '.env'))}, { recursive: true, force: true }); }
`);
  for (const enabled of [false, true]) {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [script], { env: { ...process.env, NODE_DEBUG: enabled ? 'nopainmd' : '' }, timeout: 15000 });
    assert.match(stdout, /Found 0 Markdown files.*4 read errors/);
    assert.doesNotMatch(stdout, /ENOENT|EISDIR|RAW/);
    if (!enabled) { assert.equal(stderr, ''); continue; }
    assert.match(stderr, /NOPAINMD \d+: read error/);
    const diagnostics = stderr.trim().split('\n').map(line => JSON.parse(line.slice(line.indexOf('read error ') + 'read error '.length)));
    for (const operation of ['realpath', 'lstat', 'readConfig', 'opendir', 'injected', 'readdir', 'closedir']) assert.ok(diagnostics.some(entry => entry.operation === operation), operation);
    assert.ok(diagnostics.some(entry => entry.operation === 'opendir' && entry.code === 'ENOENT' && entry.path === path.join(temporary, 'missing')));
    assert.equal(diagnostics.filter(entry => entry.operation === 'readConfig').length, 1);
    assert.ok(diagnostics.some(entry => entry.message === 'RAW failure\nwith newline'));
  }
});

test('re-index summaries report counts and limit notices, sanitize errors, and recover from removal', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'nopainmd-recovery-'));
  const root = path.join(temporary, 'base'); const external = path.join(temporary, 'outside.md');
  await mkdir(root); await writeFile(path.join(root, 'one.md'), '# One'); await writeFile(external, '# Outside');
  const logs = [];
  const readConfig = createConfig(root);
  let failSettings = false;
  const app = await createApp({ root, log: line => logs.push(line), readConfig: () => {
    if (failSettings) throw fault('EIO');
    return readConfig();
  } });
  await new Promise((resolve, reject) => app.server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.stop(); await rm(temporary, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const index = async (selected = '') => (await fetch(`${base}/api/index?${new URLSearchParams({ selected })}`)).json();
  let result = await index(external);
  assert.equal(result.filesFound, 1); assert.equal(result.readErrors, 0);
  assert.equal(logs.length, 1); assert.match(logs[0], /Found 1 Markdown files in .*base.*; 0 read errors/);
  const missing = await fetch(`${base}/api/document?${new URLSearchParams({ file: path.join(root, 'missing.md') })}`);
  assert.equal(missing.status, 404); assert.equal((await missing.json()).error, 'File not found');
  result = await index(); assert.equal(result.readErrors, 1); assert.equal(logs.length, 2);
  await rm(root, { recursive: true });
  result = await index(); assert.equal(result.filesFound, 0); assert.equal(result.readErrors, 1); assert.equal(result.partial, true);
  await mkdir(root); await writeFile(path.join(root, 'restored.MD'), '# Restored');
  result = await index(); assert.equal(result.filesFound, 1); assert.equal(result.readErrors, 0);
  assert.equal(logs.length, 4); assert.doesNotMatch(logs.join('\n'), /ENOENT|EACCES|Error:|stack/);
  assert.equal((await fetch(`${base}/api/document?${new URLSearchParams({ file: path.join(root, 'restored.MD') })}`)).status, 200);
  await writeFile(path.join(root, 'second.md'), '# Second');
  for (const [settings, limit, variable] of [
    ['NOPAINMD_INDEX_MAX_NODES=1', 'nodes', 'NOPAINMD_INDEX_MAX_NODES'],
    ['NOPAINMD_INDEX_MAX_MS=1', 'time', 'NOPAINMD_INDEX_MAX_MS'],
  ]) {
    logs.length = 0;
    await writeFile(path.join(root, '.env'), settings);
    const result = await (await fetch(`${base}/api/index`)).json();
    assert.deepEqual(result.limits, [limit]);
    assert.match(logs[0], /Found \d+ Markdown files in .*; 0 read errors\./);
    assert.equal(logs[1], `May not load all files: the ${limit} limit hit. Increase ${variable} to load more.`);
    assert.doesNotMatch(logs.join('\n'), /partial index/iu);
  }
  await writeFile(path.join(root, '.env'), 'NOPAINMD_FONT_ZOOM=125');
  assert.equal((await (await fetch(`${base}/api/config`)).json()).fontZoom, 125);
  failSettings = true;
  const fallback = await (await fetch(`${base}/api/config`)).json();
  assert.equal(fallback.fontZoom, 125);
  assert.equal(fallback.readErrors, 1);
  assert.doesNotMatch(JSON.stringify(fallback), /RAW|private|EIO/);
  assert.equal((await index()).readErrors, 2);
  failSettings = false;
  await writeFile(path.join(root, '.env'), 'NOPAINMD_FONT_ZOOM=150');
  assert.equal((await (await fetch(`${base}/api/config`)).json()).fontZoom, 150);
  assert.equal((await index()).readErrors, 0);
});

test('permission failures leave directories incomplete and allow later document and image requests', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nopainmd-read-permissions-'));
  const file = path.join(root, 'denied.md'); const image = path.join(root, 'denied.png');
  await writeFile(file, '# Recovered'); await writeFile(image, 'image');
  const logs = [];
  const app = await createApp({ root, log: line => logs.push(line) });
  await new Promise((resolve, reject) => app.server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(async () => { await chmod(file, 0o600); await chmod(image, 0o600); await app.stop(); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  await chmod(file, 0); await chmod(image, 0);
  for (const [route, target] of [['document', file], ['image', image]]) {
    const response = await fetch(`${base}/api/${route}?${new URLSearchParams({ file: target })}`);
    assert.equal(response.status, 403); assert.equal((await response.json()).error, 'Cannot read file: access denied.');
  }
  const result = await (await fetch(`${base}/api/index`)).json();
  assert.equal(result.readErrors, 2); assert.equal(result.filesFound, 1);
  assert.doesNotMatch(logs.join('\n'), /EACCES|denied\.md|denied\.png/);
  await chmod(file, 0o600);
  const recovered = await (await fetch(`${base}/api/document?${new URLSearchParams({ file })}`)).json();
  assert.equal(recovered.title, 'Recovered');
  await chmod(image, 0o600);
  const directory = path.join(root, 'restricted');
  await mkdir(directory); await writeFile(path.join(directory, 'private.md'), '# Private');
  await chmod(directory, 0);
  try {
    const result = await indexDirectory({ root });
    assert.equal(result.readErrors, 1);
    assert.doesNotMatch(result.warnings.join('\n'), /restricted|EACCES|Error:/);
    assert.equal(result.completeDirectories.includes(directory), false);
    assert.equal(result.completeDirectories.includes(root), false);
  } finally { await chmod(directory, 0o700); }
});
