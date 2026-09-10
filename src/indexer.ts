import { Worker } from 'node:worker_threads';
import { fileNodes, isMarkdown, within } from './paths.js';
import { IndexAbortError } from './index-types.js';
import type { IndexOptions, ScanMessage } from './index-types.js';
import type { IndexResult } from '../shared/types.js';
import { logReadError } from './logger.js';

export function indexDirectory({ root, selected = null, maxMs = 5000, maxNodes = 10000, signal }: IndexOptions): Promise<IndexResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const seed = selected ? fileNodes(root, selected) : [];
    const result: IndexResult = { nodes: seed.length <= maxNodes ? seed : [], completeDirectories: [], limits: seed.length > maxNodes ? ['nodes'] : [], warnings: [], stages: [], maxNodes, filesFound: 0, readErrors: 0, partial: false };
    const seen = new Set(result.nodes.map(node => node.path));
    const found = new Set(selected && within(root, selected) && isMarkdown(selected) ? [selected] : []);
    const worker = new Worker(new URL('./index-worker.js', import.meta.url), {
      workerData: { root, selected, maxNodes, deadline: started + maxMs },
    });
    let settled = false;
    const finish = async (cancelled = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      try { await worker.terminate(); } catch (error) { result.readErrors++; logReadError(error, { operation: 'worker.terminate', path: root }); }
      result.filesFound = found.size;
      result.partial = result.limits.length > 0 || result.readErrors > 0;
      if (result.readErrors) result.warnings.push(`${result.readErrors} read error${result.readErrors === 1 ? '' : 's'} occurred. Some paths could not be read.`);
      result.elapsedMs = Date.now() - started;
      if (cancelled) { result.cancelled = true; reject(new IndexAbortError(result)); } else resolve(result);
    };
    const abort = () => { void finish(true); };
    const timer = setTimeout(() => { if (!result.limits.includes('time')) result.limits.push('time'); void finish(); }, maxMs);
    worker.on('message', ({ type, value }: ScanMessage) => {
      if (settled) return;
      if (type === 'nodes') {
        const fresh = value.filter(node => !seen.has(node.path));
        if (result.nodes.length + fresh.length <= maxNodes) {
          for (const node of fresh) { result.nodes.push(node); seen.add(node.path); }
        }
      }
      if (type === 'complete') result.completeDirectories.push(value);
      if (type === 'found') found.add(value);
      if (type === 'readError') result.readErrors += value;
      if (type === 'limit' && !result.limits.includes(value)) result.limits.push(value);
      if (type === 'stage') result.stages.push(value);
      if (type === 'done') void finish();
    });
    worker.on('error', error => { result.readErrors++; logReadError(error, { operation: 'worker', path: root }); void finish(); });
    worker.on('exit', code => { if (!settled) { result.readErrors++; logReadError(new Error(`Indexer exited unexpectedly with code ${code}.`), { operation: 'worker.exit', path: root }); void finish(); } });
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}
