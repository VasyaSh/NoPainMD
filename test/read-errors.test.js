import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanDirectory } from '../src/scan.js';
import { createApp } from '../src/server.js';
import { indexDirectory } from '../src/indexer.js';
import { readSafely, ReadError } from '../src/read-errors.js';

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
});

test('read wrappers sanitize all native and nonstandard thrown values', async () => {
  for (const value of [fault('EIO'), fault('EMFILE'), fault('EACCES'), fault('ENOENT'), new Error('RAW custom'), null, 'RAW string']) {
    await assert.rejects(readSafely(() => { throw value; }), error => error instanceof ReadError && !/RAW|private/.test(error.message));
  }
});

test('re-index summaries report counts and limit notices, sanitize errors, and recover from removal', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'nopainmd-recovery-'));
  const root = path.join(temporary, 'base'); const external = path.join(temporary, 'outside.md');
  await mkdir(root); await writeFile(path.join(root, 'one.md'), '# One'); await writeFile(external, '# Outside');
  const logs = [];
  const app = await createApp({ root, log: line => logs.push(line) });
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
