import type { TreeNode } from '../shared/types.js';
import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { readSafely } from './read-errors.js';

export function isMarkdown(file: string): boolean {
  return /\.(?:md|markdown)$/iu.test(file);
}

export function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

export function absolutePath(value: string | null | undefined): string {
  if (!value || value.includes('\0') || !path.isAbsolute(value)) {
    throw Object.assign(new Error('An absolute filesystem path is required.'), { status: 400 });
  }
  return path.normalize(value);
}

export async function regularFile(value: string | null | undefined): Promise<string> {
  const target = absolutePath(value);
  const parsed = path.parse(target);
  let current = parsed.root;
  let stat;
  for (const segment of target.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    stat = await readSafely(() => lstat(current), { operation: 'lstat', path: current });
    if (stat.isSymbolicLink()) throw Object.assign(new Error('Symbolic links are not supported.'), { status: 403 });
  }
  if (!stat?.isFile()) throw Object.assign(new Error('The requested path is not a regular file.'), { status: 400 });
  return target;
}

export function fileURL(file: string, hash = ''): string {
  return `/?file=${encodeURIComponent(file).replaceAll('%2F', '/').replaceAll('%3A', ':')}${hash}`;
}

export function fileNodes(root: string, file: string): TreeNode[] {
  const external = !within(root, file);
  const chain: TreeNode[] = [];
  if (!external) {
    let dir = path.dirname(file);
    while (dir !== root && within(root, dir)) {
      chain.unshift({ path: dir, name: path.basename(dir), type: 'directory', parent: path.dirname(dir) });
      dir = path.dirname(dir);
    }
  }
  chain.push({ path: file, name: path.basename(file), type: 'file', parent: external ? root : path.dirname(file), external });
  return chain;
}
