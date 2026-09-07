import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';

export const defaults = Object.freeze({ baseDir: '.', host: 'localhost', port: 3000, font: 'Open Sans', fontZoom: 100, maxMs: 5000, maxNodes: 1000, htmlEnabled: true });
const keys = { baseDir: 'BASE_DIR', host: 'HOST', port: 'PORT', font: 'FONT', fontZoom: 'FONT_ZOOM', maxMs: 'INDEX_MAX_MS', maxNodes: 'INDEX_MAX_NODES', htmlEnabled: 'HTML_ENABLED' };

export function parseBoolean(raw) {
  const value = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
}

export function createConfig(root, cli = {}, environment = process.env) {
  const startup = { ...environment };
  let previous = { ...defaults };
  let lastFile = {};
  return async function readConfig() {
    const warnings = [];
    let file = {};
    let readErrors = 0;
    try { file = parseEnv(await readFile(path.join(root, '.env'), 'utf8')); lastFile = file; }
    catch (error) {
      if (error?.code !== 'ENOENT') {
        readErrors++;
        file = lastFile;
        warnings.push('Unable to read .env; using the last available settings.');
      } else { lastFile = {}; }
    }
    const config = {};
    for (const [key, suffix] of Object.entries(keys)) {
      const name = `NOPAINMD_${suffix}`;
      const raw = cli[key] ?? file[name] ?? startup[name] ?? defaults[key];
      let value = raw;
      let valid;
      if (key === 'htmlEnabled') {
        value = parseBoolean(raw);
        valid = value !== undefined;
      } else if (key === 'font' || key === 'host' || key === 'baseDir') {
        value = String(raw).trim();
        valid = value.length > 0 && !/[\x00-\x1f\x7f]/u.test(value);
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
      config[key] = value;
    }
    previous = { ...config };
    return { ...config, warnings, readErrors };
  };
}
