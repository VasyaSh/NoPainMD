import fs from 'node:fs';
import path from 'node:path';
import { fileNodes, isMarkdown, within } from './paths.js';

export function scanDirectory({ root, selected, maxNodes, deadline }, send, io = fs) {
  const nodes = new Set();
  const processed = new Map();
  let stopped = false;
  const readError = () => send('readError', 1);
  function checkTime() {
    if (!stopped && Date.now() >= deadline) { stopped = true; send('limit', 'time'); }
    return stopped;
  }
  function addFile(file) {
    if (within(root, file) && isMarkdown(file)) send('found', file);
    const fresh = fileNodes(root, file).filter(node => !nodes.has(node.path));
    if (nodes.size + fresh.length > maxNodes) { send('limit', 'nodes'); stopped = true; return; }
    // Commit files with all missing ancestors.
    for (const node of fresh) nodes.add(node.path);
    if (fresh.length) send('nodes', fresh);
  }
  function walk(start) {
    const stack = [];
    function enter(dir) {
      if (processed.has(dir)) return processed.get(dir);
      try { stack.push({ dir, handle: io.opendirSync(dir), complete: true }); return true; }
      catch { readError(); processed.set(dir, false); return false; }
    }
    function leave(complete) {
      const frame = stack.pop();
      let success = complete && frame.complete;
      try { frame.handle.closeSync(); } catch { readError(); success = false; }
      processed.set(frame.dir, success);
      if (success) send('complete', frame.dir);
      else if (stack.length) stack.at(-1).complete = false;
    }
    if (!enter(start)) return;
    try {
      while (stack.length && !checkTime()) {
        const frame = stack.at(-1);
        let entry;
        try { entry = frame.handle.readSync(); }
        catch { readError(); leave(false); continue; }
        if (!entry) { leave(true); continue; }
        try {
          if (entry.isSymbolicLink()) continue;
          const target = path.join(frame.dir, entry.name);
          if (entry.isDirectory()) { if (!enter(target)) frame.complete = false; }
          else if (entry.isFile() && isMarkdown(entry.name)) addFile(target);
        } catch { readError(); frame.complete = false; }
      }
    } finally {
      while (stack.length) leave(false);
    }
  }
  if (selected && !checkTime()) addFile(selected);
  if (selected && within(root, selected) && !stopped) { send('stage', 'directory'); walk(path.dirname(selected)); }
  if (!stopped) { send('stage', 'base'); walk(root); }
}
