import type { IndexResult, MarkdownDocument, RenderedMarkdown, TreeNode, ViewerConfig, ViewerDataSource } from './types.js';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
function treeNode(value: unknown): value is TreeNode {
  return record(value) && typeof value.path === 'string' && typeof value.name === 'string' && typeof value.parent === 'string' && ['file', 'directory'].includes(String(value.type)) && (value.external === undefined || typeof value.external === 'boolean');
}
function rendered(value: unknown): value is RenderedMarkdown {
  return record(value) && typeof value.html === 'string' && typeof value.title === 'string'
    && record(value.markers) && Object.values(value.markers).every(marker => record(marker) && (marker.kind === 'mermaid' || (marker.kind === 'heading' && typeof marker.outline === 'boolean')))
    && Array.isArray(value.headings) && value.headings.every((heading: unknown) => record(heading) && typeof heading.id === 'string' && typeof heading.text === 'string' && positive(heading.level));
}
function documentData(value: unknown): value is MarkdownDocument {
  return record(value) && rendered(value) && typeof value.path === 'string' && typeof value.sourceURL === 'string' && ['/', '\\'].includes(String(value.separator))
    && typeof value.imageToken === 'string' && typeof value.name === 'string' && typeof value.parent === 'string' && typeof value.external === 'boolean'
    && typeof value.htmlEnabled === 'boolean' && rendered(value.alternate);
}
function configData(value: unknown): value is ViewerConfig {
  return record(value) && typeof value.root === 'string' && ['/', '\\'].includes(String(value.separator)) && typeof value.font === 'string'
    && positive(value.fontZoom) && positive(value.maxNodes) && typeof value.htmlEnabled === 'boolean' && strings(value.warnings);
}
function indexData(value: unknown): value is IndexResult {
  return record(value) && Array.isArray(value.nodes) && value.nodes.every(treeNode) && strings(value.completeDirectories)
    && strings(value.limits) && value.limits.every(limit => ['time', 'nodes'].includes(limit)) && strings(value.warnings)
    && strings(value.stages) && value.stages.every(stage => ['base', 'directory'].includes(stage)) && positive(value.maxNodes)
    && typeof value.filesFound === 'number' && typeof value.readErrors === 'number' && typeof value.partial === 'boolean';
}

export interface HTTPSourceOptions {
  baseURL?: string | URL;
  fetch?: typeof globalThis.fetch;
}

/** Connect to a NoPainMD API or a compatible endpoint supplied by the host. */
export function createHTTPSource(options: HTTPSourceOptions = {}): ViewerDataSource {
  const base = new URL(options.baseURL ?? '/api/', globalThis.location?.href ?? 'http://localhost/');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const request = options.fetch ?? globalThis.fetch;
  async function get<T>(route: string, params: Record<string, string>, validate: (value: unknown) => value is T, signal?: AbortSignal): Promise<T> {
    const url = new URL(route, base);
    url.search = new URLSearchParams(params).toString();
    const response = await request(url, { signal });
    const data: unknown = await response.json();
    if (!response.ok) throw Object.assign(new Error(record(data) && typeof data.error === 'string' ? data.error : 'Request failed'), { status: response.status });
    if (!validate(data)) throw new Error(`Invalid NoPainMD ${route} response.`);
    return data;
  }
  return {
    getConfig: signal => get('config', {}, configData, signal),
    getDocument: (file, { htmlEnabled, signal }) => get('document', { file, html: String(htmlEnabled), variants: 'true' }, documentData, signal),
    index: (selected, signal) => get('index', selected ? { selected } : {}, indexData, signal),
    imageURL(file, token) {
      const url = new URL('image', base);
      url.search = new URLSearchParams({ file, token }).toString();
      return url.href;
    },
  };
}
