import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'node_modules/mermaid/dist');
const target = path.join(root, 'public/vendor/mermaid');
await rm(target, { recursive: true, force: true });
await mkdir(path.join(target, 'chunks'), { recursive: true });
// Ship the minified entry and lazy chunks.
await cp(path.join(source, 'mermaid.esm.min.mjs'), path.join(target, 'mermaid.esm.min.mjs'));
await cp(path.join(source, 'chunks/mermaid.esm.min'), path.join(target, 'chunks/mermaid.esm.min'), { recursive: true, filter: file => !file.endsWith('.map') });
await cp(path.join(root, 'node_modules/mermaid/LICENSE'), path.join(target, 'LICENSE'));
const sanitizer = path.join(root, 'public/vendor/dompurify');
await mkdir(sanitizer, { recursive: true });
await cp(path.join(root, 'node_modules/dompurify/dist/purify.min.js'), path.join(sanitizer, 'purify.min.js'));
await cp(path.join(root, 'node_modules/dompurify/LICENSE'), path.join(sanitizer, 'LICENSE'));
console.log('Bundled Mermaid and DOMPurify browser modules.');
