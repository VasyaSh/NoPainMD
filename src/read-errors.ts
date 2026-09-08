import { errorCode, errorMessage } from '../shared/errors.js';
import { logReadError } from './logger.js';
import type { ReadContext } from './logger.js';
// Keep native errors out of user-facing responses.
export class ReadError extends Error {
  readonly status: number;
  constructor(cause: unknown) {
    const code = errorCode(cause);
    const missing = code === 'ENOENT' || code === 'ENOTDIR';
    const denied = code === 'EACCES' || code === 'EPERM';
    super(missing ? 'File not found' : denied ? 'Cannot read file: access denied.' : 'Unable to read the requested file. Please try again.');
    this.name = 'ReadError';
    this.status = missing ? 404 : denied ? 403 : 500;
  }
}

export async function readSafely<T>(operation: () => T | Promise<T>, context: ReadContext = { operation: 'read' }): Promise<T> {
  try { return await operation(); }
  catch (error) { logReadError(error, context); throw new ReadError(error); }
}

export function cliError(error: unknown): string {
  if (error instanceof ReadError) return error.message;
  if ((error && typeof error === 'object' && 'syscall' in error) || /^ERR_FS_/u.test(errorCode(error) || '')) return 'Unable to read a required file or directory. Please try again.';
  return errorMessage(error);
}
