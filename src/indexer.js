import { Worker } from 'node:worker_threads';
import { fileNodes, isMarkdown, within } from './paths.js';

export function indexDirectory({ root, selected = null, maxMs = 5000, maxNodes = 1000, signal }) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const seed = selected ? fileNodes(root, selected) : [];
    const result = { nodes: seed.length <= maxNodes ? seed : [], completeDirectories: [], limits: seed.length > maxNodes ? ['nodes'] : [], warnings: [], stages: [], maxNodes, filesFound: 0, readErrors: 0 };
    const seen = new Set(result.nodes.map(node => node.path));
    const found = new Set(selected && within(root, selected) && isMarkdown(selected) ? [selected] : []);
    const worker = new Worker(new URL('./index-worker.js', import.meta.url), {
      workerData: { root, selected, maxNodes, deadline: started + maxMs },
    });
    let settled = false;
    const finish = async error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      try { await worker.terminate(); } catch { result.readErrors++; }
      result.filesFound = found.size;
      result.partial = result.limits.length > 0 || result.readErrors > 0;
      if (result.readErrors) result.warnings.push(`${result.readErrors} read error${result.readErrors === 1 ? '' : 's'} occurred. Some paths could not be read.`);
      result.elapsedMs = Date.now() - started;
      if (error) { result.cancelled = true; error.result = result; reject(error); } else resolve(result);
    };
    const abort = () => finish(Object.assign(new Error('Indexing cancelled'), { name: 'AbortError' }));
    const timer = setTimeout(() => { if (!result.limits.includes('time')) result.limits.push('time'); finish(); }, maxMs);
    worker.on('message', ({ type, value }) => {
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
      if (type === 'done') finish();
    });
    worker.on('error', () => { result.readErrors++; finish(); });
    worker.on('exit', () => { if (!settled) { result.readErrors++; finish(); } });
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}
