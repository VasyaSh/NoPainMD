import { debuglog } from 'node:util';
import { errorCode, errorMessage } from '../shared/errors.js';

const debug = debuglog('nopainmd');

export interface ReadContext { operation: string; path?: string }

export function logReadError(error: unknown, context: ReadContext): void {
  if (!debug.enabled) return;
  try {
    debug('read error %s', JSON.stringify({
      ...context,
      code: errorCode(error),
      message: typeof error === 'string' ? error : errorMessage(error),
    }));
  } catch {}
}
