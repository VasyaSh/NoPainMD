import fs from 'node:fs';
import path from 'node:path';
import { fileNodes, isMarkdown, within } from './paths.js';
import type { DirectoryHandle, ScanIO, ScanOptions, ScanSender } from './index-types.js';
import { logReadError } from './logger.js';

export function scanDirectory({ root, selected, maxNodes, deadline }: ScanOptions, send: ScanSender, io: ScanIO = fs): void {
  const nodes = new Set<string>();
  const processed = new Map<string, boolean>();
  let stopped = false;
  const readError = (error: unknown, operation: string, path: string) => {
    send('readError', 1);
    logReadError(error, { operation, path });
  };
  function checkTime() {
    if (!stopped && Date.now() >= deadline) { stopped = true; send('limit', 'time'); }
    return stopped;
  }
  function addFile(file: string) {
    if (within(root, file) && isMarkdown(file)) send('found', file);
    const fresh = fileNodes(root, file).filter(node => !nodes.has(node.path));
    if (nodes.size + fresh.length > maxNodes) { send('limit', 'nodes'); stopped = true; return; }
    // Commit files with all missing ancestors.
    for (const node of fresh) nodes.add(node.path);
    if (fresh.length) send('nodes', fresh);
  }
  function walk(start: string) {
    const stack: { dir: string; handle: DirectoryHandle; complete: boolean }[] = [];
    function enter(dir: string) {
      if (processed.has(dir)) return processed.get(dir);
      try { stack.push({ dir, handle: io.opendirSync(dir), complete: true }); return true; }
      catch (error) { readError(error, 'opendir', dir); processed.set(dir, false); return false; }
    }
    function leave(complete: boolean) {
      const frame = stack.pop();
      if (!frame) return;
      let success = complete && frame.complete;
      try { frame.handle.closeSync(); } catch (error) { readError(error, 'closedir', frame.dir); success = false; }
      processed.set(frame.dir, success);
      if (success) send('complete', frame.dir);
      else { const parent = stack.at(-1); if (parent) parent.complete = false; }
    }
    if (!enter(start)) return;
    try {
      while (stack.length && !checkTime()) {
        const frame = stack.at(-1);
        if (!frame) break;
        let entry;
        try { entry = frame.handle.readSync(); }
        catch (error) { readError(error, 'readdir', frame.dir); leave(false); continue; }
        if (!entry) { leave(true); continue; }
        try {
          if (entry.isSymbolicLink()) continue;
          const target = path.join(frame.dir, entry.name);
          if (entry.isDirectory()) { if (!enter(target)) frame.complete = false; }
          else if (entry.isFile() && isMarkdown(entry.name)) addFile(target);
        } catch (error) { readError(error, 'entry', frame.dir); frame.complete = false; }
      }
    } finally {
      while (stack.length) leave(false);
    }
  }
  if (selected && !checkTime()) addFile(selected);
  if (selected && within(root, selected) && !stopped) { send('stage', 'directory'); walk(path.dirname(selected)); }
  if (!stopped) { send('stage', 'base'); walk(root); }
}
