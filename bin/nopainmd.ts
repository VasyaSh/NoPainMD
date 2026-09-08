#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createInterface, type Interface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import open from 'open';
import { errorCode } from '../shared/errors.js';
import { createConfig } from '../src/config.js';
import { createApp } from '../src/server.js';
import { cliError, readSafely } from '../src/read-errors.js';

try {
  const { values } = parseArgs({ options: { help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, host: { type: 'string' }, port: { type: 'string' }, 'no-open': { type: 'boolean' } } });
  if (values.help) {
    console.log('NoPainMD — browse local Markdown\n\nUsage: npx nopainmd [--host localhost] [--port 3000] [--no-open]\n\n  --port 0     Pick an available port\n  --no-open    Print the URL without launching a browser\n  -h, --help   Show help\n  -v, --version Show version\n\nNOPAINMD_BASE_DIR selects the directory to browse (default: .).\nRelative paths and .env are resolved from the launch directory.\nNODE_DEBUG=nopainmd enables read-error diagnostics on stderr.\nPress Ctrl+C to exit.');
  } else if (values.version) {
    const packageFile = fileURLToPath(new URL('../../package.json', import.meta.url));
    const metadata: unknown = JSON.parse(await readSafely(() => readFile(packageFile, 'utf8'), { operation: 'readFile', path: packageFile }));
    if (!metadata || typeof metadata !== 'object' || !('version' in metadata) || typeof metadata.version !== 'string') throw new Error('Invalid package metadata.');
    console.log(metadata.version);
  } else {
    if (values.port !== undefined && (!/^\d+$/u.test(values.port) || Number(values.port) > 65535)) throw new Error('--port must be an integer from 0 to 65535.');
    const launchDirectory = process.cwd();
    const readConfig = createConfig(launchDirectory, { host: values.host, port: values.port });
    const config = await readConfig();
    const root = path.resolve(launchDirectory, config.baseDir);
    for (const warning of config.warnings) console.error(warning);
    const app = await createApp({ root, readConfig, host: config.host, initialReadErrors: config.readErrors });
    let port = config.port;
    let terminal: Interface | undefined;
    let exiting = false;
    const exit = () => {
      if (exiting) return;
      exiting = true;
      terminal?.close();
      void app.stop().then(() => process.exit(0), () => process.exit(0));
    };
    process.on('SIGINT', exit);
    process.on('SIGTERM', exit);
    try {
      while (true) {
        try {
          await new Promise<void>((resolve, reject) => {
            const fail = (error: Error) => { app.server.off('listening', ready); reject(error); };
            const ready = () => { app.server.off('error', fail); resolve(); };
            app.server.once('error', fail).once('listening', ready).listen(port, config.host);
          });
          break;
        } catch (error) {
          if (errorCode(error) !== 'EADDRINUSE') throw error;
          if (!process.stdin.isTTY) throw new Error(`Port ${port} is busy. Use --port <number> or --port 0 for a random available port.`, { cause: error });
          if (!terminal) {
            terminal = createInterface({ input: process.stdin, output: process.stdout });
            terminal.on('SIGINT', exit);
          }
          let answer;
          while (true) {
            answer = await new Promise<string>(resolve => terminal?.question(`Port ${port} is busy. Enter another port, or press Enter for a random available port: `, resolve));
            answer = answer.trim();
            if (answer === '' || (/^\d+$/u.test(answer) && Number(answer) > 0 && Number(answer) <= 65535)) break;
            console.error('Enter an integer from 1 to 65535, or press Enter.');
          }
          port = answer === '' ? 0 : Number(answer);
        }
      }
    } finally { terminal?.close(); }
    const browserHost = ['0.0.0.0', '::'].includes(config.host) ? 'localhost' : config.host.includes(':') ? `[${config.host}]` : config.host;
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Unable to determine the server port.');
    const url = `http://${browserHost}:${address.port}/`;
    console.log(`NoPainMD\nDirectory: ${app.root}\n${url}\nPress Ctrl+C to exit.`);
    if (!values['no-open']) {
      try { await open(url); } catch { console.error(`Could not open the browser. Open ${url} manually.`); }
    }
  }
} catch (error) { console.error(`NoPainMD: ${cliError(error)}`); process.exitCode = 1; }
