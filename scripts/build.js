import { cp, mkdir, rm, chmod, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'dist');
await rm(target, { recursive: true, force: true });
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc')], { cwd: root, stdio: 'inherit' });
await cp(path.join(root, 'public'), path.join(target, 'public'), { recursive: true, filter: file => !file.includes(`${path.sep}vendor`) });
await build({
  absWorkingDir: root,
  entryPoints: ['client/app.ts', 'client/viewer.ts', 'client/document.ts'],
  outdir: 'dist/public', bundle: true, splitting: true, format: 'esm', platform: 'browser',
  target: 'es2022', loader: { '.html': 'text', '.css': 'text' },
  chunkNames: '[name]-[hash]', assetNames: 'assets/[name]-[hash]',
  minify: true, legalComments: 'linked',
});
await build({ absWorkingDir: root, entryPoints: ['client/preferences.ts'], outfile: 'dist/public/preferences.js', bundle: true, format: 'iife', target: 'es2022', minify: true });
for (const file of await readdir(path.join(target, 'client'))) {
  if (file.endsWith('.js')) await rm(path.join(target, 'client', file));
}
for (const dependency of ['mermaid', 'dompurify']) {
  const directory = path.join(target, 'public/vendor', dependency);
  await mkdir(directory, { recursive: true });
  await cp(path.join(root, 'node_modules', dependency, 'LICENSE'), path.join(directory, 'LICENSE'));
}
await chmod(path.join(target, 'bin/nopainmd.js'), 0o755);
console.log('Built TypeScript, declarations, and browser bundles.');
