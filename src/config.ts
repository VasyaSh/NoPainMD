import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { parseEnv, promisify } from 'node:util';
import { errorCode } from '../shared/errors.js';
import type { Config, Settings } from '../shared/types.js';
import { logReadError } from './logger.js';

export const defaults: Readonly<Settings> = Object.freeze({ baseDir: '.', host: 'localhost', port: 3000, font: 'Open Sans', fontZoom: 100, maxMs: 5000, maxNodes: 10000, htmlEnabled: true });
const keys = { baseDir: 'BASE_DIR', host: 'HOST', port: 'PORT', font: 'FONT', fontZoom: 'FONT_ZOOM', maxMs: 'INDEX_MAX_MS', maxNodes: 'INDEX_MAX_NODES', htmlEnabled: 'HTML_ENABLED' } as const;
const execute = promisify(execFile);
export type ConfigOverrides = { [K in keyof Settings]?: Settings[K] | string };
export type ReadConfig = () => Promise<Config>;

async function defaultHost(environment: NodeJS.ProcessEnv): Promise<string> {
  if (!(environment.SSH_CONNECTION || environment.SSH_CLIENT || environment.SSH_TTY)) return defaults.host;
  try {
    const { stdout } = await execute('hostname', ['-f'], { env: environment, encoding: 'utf8', timeout: 1000, maxBuffer: 1024, windowsHide: true });
    return stdout.trim() || defaults.host;
  } catch { return defaults.host; }
}

export function parseBoolean(raw: unknown): boolean | undefined {
  const value = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
}

export function createConfig(root: string, cli: ConfigOverrides = {}, environment: NodeJS.ProcessEnv = process.env): ReadConfig {
  const startup = { ...environment };
  let previous = { ...defaults };
  let lastFile: Record<string, string | undefined> = {};
  let fallbackHost: Promise<string> | undefined;
  return async function readConfig() {
    const warnings = [];
    let file: Record<string, string | undefined> = {};
    let readErrors = 0;
    try { file = parseEnv(await readFile(path.join(root, '.env'), 'utf8')); lastFile = file; }
    catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        logReadError(error, { operation: 'readConfig', path: path.join(root, '.env') });
        readErrors++;
        file = lastFile;
        warnings.push('Unable to read .env; using the last available settings.');
      } else { lastFile = {}; }
    }
    const config = { ...previous };
    for (const key of Object.keys(keys) as (keyof Settings)[]) {
      const suffix = keys[key];
      const name = `NOPAINMD_${suffix}`;
      const raw = cli[key] ?? file[name] ?? startup[name] ?? (key === 'host' ? await (fallbackHost ??= defaultHost(startup)) : defaults[key]);
      let value: string | number | boolean | undefined;
      let valid: boolean;
      if (key === 'htmlEnabled') {
        value = parseBoolean(raw);
        valid = value !== undefined;
      } else if (key === 'font' || key === 'host' || key === 'baseDir') {
        value = String(raw).trim();
        valid = value.length > 0 && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
        if (key === 'host') valid &&= !/[\s/\\?#]/u.test(value);
      } else {
        value = Number(raw);
        valid = String(raw).trim() !== '' && Number.isFinite(value) && value > 0;
        if (key !== 'fontZoom') valid &&= Number.isSafeInteger(value);
        if (key === 'port') valid = Number.isInteger(value) && value >= 0 && value <= 65535 && String(raw).trim() !== '';
      }
      if (!valid) {
        value = previous[key];
        warnings.push(`Invalid ${name}; using ${value}.`);
      }
      if (typeof value === 'boolean' && key === 'htmlEnabled') config[key] = value;
      else if (typeof value === 'string' && (key === 'font' || key === 'host' || key === 'baseDir')) config[key] = value;
      else if (typeof value === 'number' && (key === 'fontZoom' || key === 'port' || key === 'maxMs' || key === 'maxNodes')) config[key] = value;
    }
    previous = { ...config };
    return { ...config, warnings, readErrors };
  };
}
