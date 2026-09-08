export type Theme = 'light' | 'dark';
export type IndexLimit = 'time' | 'nodes';
export type IndexStage = 'directory' | 'base';

export interface Settings {
  baseDir: string;
  host: string;
  port: number;
  font: string;
  fontZoom: number;
  maxMs: number;
  maxNodes: number;
  htmlEnabled: boolean;
}

export interface Config extends Settings {
  warnings: string[];
  readErrors: number;
}

export interface ViewerConfig {
  root: string;
  separator: '/' | '\\';
  font: string;
  fontZoom: number;
  maxNodes: number;
  htmlEnabled: boolean;
  warnings: string[];
}

export interface TreeNode {
  path: string;
  parent: string;
  name: string;
  type: 'file' | 'directory';
  external?: boolean;
}

export interface Heading {
  id: string;
  text: string;
  level: number;
}

export type RenderMarker = { kind: 'heading'; outline: boolean } | { kind: 'mermaid' };

export interface RenderedMarkdown {
  html: string;
  markers: Record<string, RenderMarker>;
  headings: Heading[];
  title: string;
}

export interface MarkdownDocument extends RenderedMarkdown {
  path: string;
  sourceURL: string;
  separator: '/' | '\\';
  imageToken: string;
  htmlEnabled: boolean;
  alternate: RenderedMarkdown;
  name: string;
  external: boolean;
  parent: string;
}

export interface IndexResult {
  nodes: TreeNode[];
  completeDirectories: string[];
  limits: IndexLimit[];
  warnings: string[];
  stages: IndexStage[];
  maxNodes: number;
  filesFound: number;
  readErrors: number;
  partial: boolean;
  elapsedMs?: number;
  cancelled?: boolean;
}
