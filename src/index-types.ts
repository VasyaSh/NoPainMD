import type { IndexLimit, IndexResult, IndexStage, TreeNode } from '../shared/types.js';

export interface IndexOptions {
  root: string;
  selected?: string | null;
  maxMs?: number;
  maxNodes?: number;
  signal?: AbortSignal;
}
export interface ScanOptions {
  root: string;
  selected?: string | null;
  maxNodes: number;
  deadline: number;
}
export interface ScanEvents {
  nodes: TreeNode[];
  complete: string;
  found: string;
  readError: number;
  limit: IndexLimit;
  stage: IndexStage;
  done: undefined;
}
export type ScanMessage = { [K in keyof ScanEvents]: { type: K; value: ScanEvents[K] } }[keyof ScanEvents];
export type ScanSender = <K extends keyof ScanEvents>(type: K, value: ScanEvents[K]) => void;
export interface DirectoryEntry {
  name: string;
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
}
export interface DirectoryHandle {
  readSync(): DirectoryEntry | null;
  closeSync(): void;
}
export interface ScanIO { opendirSync(path: string): DirectoryHandle }
export class IndexAbortError extends Error {
  override name = 'AbortError';
  constructor(readonly result: IndexResult) { super('Indexing cancelled'); }
}
