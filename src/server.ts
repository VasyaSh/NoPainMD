import http from 'node:http';
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { absolutePath, regularFile, within } from './paths.js';
import { renderMarkdown } from './markdown.js';
import { indexDirectory } from './indexer.js';
import { createConfig, defaults, parseBoolean } from './config.js';
import { ReadError, readSafely } from './read-errors.js';
import { limitNotice } from '../shared/limits.js';
import { errorMessage, errorStatus, isAbortError } from '../shared/errors.js';
import { IndexAbortError } from './index-types.js';
import type { Config, IndexResult } from '../shared/types.js';
import type { ReadConfig } from './config.js';
import { logReadError } from './logger.js';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const imageTypes = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico']);

export interface AppOptions {
  root?: string;
  readConfig?: ReadConfig;
  host?: string;
  log?: (message: string) => void;
  initialReadErrors?: number;
}
export interface NoPainMDServer { server: http.Server; root: string; stop(): Promise<void> }
export type { Config, IndexResult } from '../shared/types.js';
export { renderMarkdown } from './markdown.js';
export { createConfig } from './config.js';

export async function createApp({ root = process.cwd(), readConfig, host = 'localhost', log = console.log, initialReadErrors = 0 }: AppOptions = {}): Promise<NoPainMDServer> {
  let pendingReadErrors = initialReadErrors;
  root = path.resolve(root);
  try { root = await realpath(root); } catch (error) { pendingReadErrors++; logReadError(error, { operation: 'realpath', path: root }); }
  readConfig ??= createConfig(root);
  const configReader = readConfig;
  let lastConfig: Config = { ...defaults, warnings: [], readErrors: 0 };
  async function settings() {
    try { lastConfig = await configReader(); }
    catch (error) { logReadError(error, { operation: 'readConfig' }); lastConfig = { ...lastConfig, warnings: ['Unable to read settings; using the last available settings.'], readErrors: 1 }; }
    pendingReadErrors += lastConfig.readErrors || 0;
    return lastConfig;
  }
  function report(result: IndexResult) {
    result.readErrors += pendingReadErrors;
    pendingReadErrors = 0;
    result.partial ||= result.readErrors > 0;
    const errorLabel = `read error${result.readErrors === 1 ? '' : 's'}`;
    result.warnings = result.readErrors ? [`${result.readErrors} ${errorLabel} occurred. Some paths could not be read.`] : [];
    const suffix = result.cancelled ? ' Indexing cancelled.' : '';
    log(`Found ${result.filesFound} Markdown files in ${JSON.stringify(root)}; ${result.readErrors} ${errorLabel}.${suffix}`);
    for (const limit of result.limits) log(limitNotice(limit));
  }
  const imageTokens = new Map<string, string>();
  const active = new Set<AbortController>();
  const server = http.createServer((req, res) => { void handleRequest(req, res); });
  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (value: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405);
      const url = new URL(req.url ?? '/', 'http://localhost');
      const requestHost = new URL(`http://${req.headers.host || 'localhost'}`).hostname.replace(/^\[|\]$/gu, '');
      if (!['0.0.0.0', '::'].includes(host) && ![host, 'localhost', '127.0.0.1', '::1'].includes(requestHost)) return json({ error: 'Invalid host' }, 403);
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json({ error: 'Cross-origin requests are not permitted' }, 403);
      if (url.pathname === '/api/config') return json({ root, separator: path.sep, ...(await settings()) });
      if (url.pathname === '/api/document') {
        const htmlOption = url.searchParams.get('html');
        const htmlEnabled = htmlOption === null ? (await settings()).htmlEnabled : parseBoolean(htmlOption);
        if (htmlEnabled === undefined) return json({ error: 'Invalid HTML setting.' }, 400);
        const file = await regularFile(url.searchParams.get('file'));
        const source = await readSafely(() => readFile(file, 'utf8'), { operation: 'readFile', path: file });
        const external = !within(root, file);
        const token = randomUUID();
        imageTokens.set(token, external ? path.dirname(file) : root);
        const oldest = imageTokens.keys().next().value;
        if (imageTokens.size > 200 && oldest) imageTokens.delete(oldest);
        const rendered = renderMarkdown(source, file, token, { htmlEnabled });
        const alternate = url.searchParams.get('variants') === 'true' ? renderMarkdown(source, file, token, { htmlEnabled: !htmlEnabled }) : undefined;
        return json({ path: file, sourceURL: pathToFileURL(file).href, separator: path.sep, imageToken: token, htmlEnabled, alternate, name: path.basename(file), external, parent: external ? root : path.dirname(file), ...rendered });
      }
      if (url.pathname === '/api/index') {
        let selected = url.searchParams.get('selected');
        if (selected) { try { selected = await regularFile(selected); } catch (error) { if (error instanceof ReadError) pendingReadErrors++; selected = null; } }
        const config = await settings();
        const controller = new AbortController();
        active.add(controller);
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        let result: IndexResult = { nodes: [], completeDirectories: [], limits: [], warnings: [], stages: [], maxNodes: config.maxNodes, filesFound: 0, readErrors: 1, partial: true };
        try {
          result = await indexDirectory({ root, selected, maxMs: config.maxMs, maxNodes: config.maxNodes, signal: controller.signal });
        } catch (error) {
          if (error instanceof IndexAbortError) result = error.result;
          else if (!isAbortError(error)) logReadError(error, { operation: 'index', path: root });
          if (isAbortError(error)) throw error;
        } finally { active.delete(controller); report(result); }
        return json({ ...result, warnings: [...config.warnings, ...result.warnings] });
      }
      if (url.pathname === '/api/image') {
        const file = absolutePath(url.searchParams.get('file'));
        const allowed = imageTokens.get(url.searchParams.get('token') ?? '');
        if ((!within(root, file) && (!allowed || !within(allowed, file))) || !imageTypes.has(path.extname(file).toLowerCase())) return json({ error: 'Image path is not permitted' }, 403);
        await regularFile(file);
        // Sandbox SVGs to prevent same-origin script execution.
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
        const buffer = await readSafely(() => readFile(file), { operation: 'readFile', path: file });
        res.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
        res.end(req.method === 'HEAD' ? undefined : buffer);
        return;
      }
      if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const target = path.resolve(publicRoot, relative);
      if (!within(publicRoot, target)) return json({ error: 'Not found' }, 404);
      const buffer = await readSafely(() => readFile(target), { operation: 'readFile', path: target });
      res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : buffer);
    } catch (error) {
      if (error instanceof ReadError) pendingReadErrors++;
      if (res.destroyed) return;
      if (isAbortError(error)) { res.destroy(); return; }
      const status = errorStatus(error) || 500;
      json({ error: error instanceof ReadError || errorStatus(error) ? errorMessage(error) : 'Unable to complete the request. Please try again.' }, status);
    }
  }
  const stop = async () => {
    for (const controller of active) controller.abort();
    server.closeIdleConnections();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  };
  return { server, root, stop };
}
