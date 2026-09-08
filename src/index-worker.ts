import { parentPort, workerData } from 'node:worker_threads';
import { scanDirectory } from './scan.js';
import type { ScanOptions, ScanSender } from './index-types.js';
import { logReadError } from './logger.js';

const send: ScanSender = (type, value) => parentPort?.postMessage({ type, value });
try { scanDirectory(workerData as ScanOptions, send); }
catch (error) { send('readError', 1); logReadError(error, { operation: 'scan' }); }
finally { send('done', undefined); }
