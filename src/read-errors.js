// Never expose native filesystem errors.
export class ReadError extends Error {
  constructor(cause) {
    const code = cause?.code;
    const missing = code === 'ENOENT' || code === 'ENOTDIR';
    const denied = code === 'EACCES' || code === 'EPERM';
    super(missing ? 'File not found' : denied ? 'Cannot read file: access denied.' : 'Unable to read the requested file. Please try again.');
    this.name = 'ReadError';
    this.status = missing ? 404 : denied ? 403 : 500;
  }
}

export async function readSafely(operation) {
  try { return await operation(); }
  catch (error) { throw new ReadError(error); }
}

export function cliError(error) {
  if (error instanceof ReadError) return error.message;
  if (error?.syscall || /^ERR_FS_/u.test(error?.code || '')) return 'Unable to read a required file or directory. Please try again.';
  return error?.message || 'Unable to complete the operation.';
}
