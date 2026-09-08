import type { IndexLimit } from './types.js';
export function limitNotice(limit: IndexLimit): string {
  return `May not load all files: the ${limit} limit hit. Increase NOPAINMD_INDEX_MAX_${limit === 'time' ? 'MS' : 'NODES'} to load more.`;
}
