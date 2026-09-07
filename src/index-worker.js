import { parentPort, workerData } from 'node:worker_threads';
import { scanDirectory } from './scan.js';

const send = (type, value) => parentPort.postMessage({ type, value });
try { scanDirectory(workerData, send); }
catch { send('readError', 1); }
finally { send('done', null); }
