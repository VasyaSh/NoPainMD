import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/nopainmd.js', import.meta.url));

test('CLI help/version and invalid ports work without starting a server', async () => {
  assert.match((await exec(process.execPath, [cli, '--help'])).stdout, /--port 0/);
  assert.equal((await exec(process.execPath, [cli, '--version'])).stdout.trim(), '0.1.13');
  await assert.rejects(exec(process.execPath, [cli, '--port', 'not-a-port']), error => error.code === 1 && /--port must/.test(error.stderr));
});

test('occupied port fails with actionable instructions in a noninteractive terminal', async t => {
  const busy = createServer();
  await new Promise((resolve, reject) => busy.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => busy.close(resolve)));
  await assert.rejects(exec(process.execPath, [cli, '--host', '127.0.0.1', '--port', String(busy.address().port), '--no-open']), error => error.code === 1 && /is busy/.test(error.stderr) && /--port 0/.test(error.stderr));
});

test('base directory resolves startup paths, keeps launch .env settings, and tolerates missing directories', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'nopainmd-base-dir-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const launch = path.join(temporary, 'launch');
  const docs = path.join(temporary, 'Project docs');
  await mkdir(launch); await mkdir(docs);
  await writeFile(path.join(launch, 'launch.md'), '# Launch');
  await writeFile(path.join(docs, 'target.md'), '# Target');
  await writeFile(path.join(docs, '.env'), 'NOPAINMD_FONT="Must not load"');
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NOPAINMD_')));
  for (const [value, setting, expected, filename] of [
    [undefined, '', launch, 'launch.md'],
    ['../Project docs', '', docs, 'target.md'],
    [docs, '', docs, 'target.md'],
    ['ignored', 'NOPAINMD_BASE_DIR="../Project docs"', docs, 'target.md'],
    ['../missing', '', path.join(temporary, 'missing'), null],
  ]) {
    await writeFile(path.join(launch, '.env'), setting);
    const env = { ...environment };
    if (value !== undefined) env.NOPAINMD_BASE_DIR = value;
    const child = spawn(process.execPath, [cli, '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: launch, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', chunk => { output += chunk; });
    try {
      const url = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('CLI startup timed out')), 10000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`CLI exited with ${code}`)); });
        child.stdout.on('data', chunk => {
          output += chunk;
          const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//u);
          if (match) { clearTimeout(timer); resolve(match[0]); }
        });
      });
      assert.ok(output.includes(`Directory: ${expected}`));
      let config = await (await fetch(`${url}api/config`)).json();
      assert.equal(config.root, expected);
      assert.equal(config.font, 'Open Sans');
      const index = await (await fetch(`${url}api/index`)).json();
      assert.deepEqual(index.nodes.map(node => node.name), filename ? [filename] : []);
      assert.equal(index.filesFound, filename ? 1 : 0);
      if (!filename) assert.ok(index.readErrors > 0);
      await writeFile(path.join(launch, '.env'), 'NOPAINMD_BASE_DIR=elsewhere\nNOPAINMD_FONT_ZOOM=125');
      config = await (await fetch(`${url}api/config`)).json();
      assert.equal(config.root, expected);
      assert.equal(config.fontZoom, 125);
      assert.doesNotMatch(output, /ENOENT|EACCES|Error:/);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const stopped = once(child, 'exit');
        child.kill('SIGINT');
        await stopped;
      }
    }
  }
});
