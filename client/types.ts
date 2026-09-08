import type { IndexResult, MarkdownDocument, Theme, ViewerConfig } from '../shared/types.js';

export type * from '../shared/types.js';

export interface DocumentRequest {
  htmlEnabled: boolean;
  signal?: AbortSignal;
}

/** Supplies data to the viewer; both HTML variants are required for instant toggling. */
export interface ViewerDataSource {
  getConfig(signal?: AbortSignal): Promise<ViewerConfig>;
  getDocument(file: string, options: DocumentRequest): Promise<MarkdownDocument>;
  index(selected: string | null, signal?: AbortSignal): Promise<IndexResult>;
  imageURL?(file: string, token: string): string;
}

export interface ViewerOptions {
  source?: ViewerDataSource;
  /** HTTP API directory, relative to the host page or absolute. Defaults to /api/. */
  apiBaseURL?: string | URL;
  /** Directory containing fonts; defaults to assets next to the viewer bundle. */
  assetBaseURL?: string | URL;
  file?: string | null;
  hash?: string;
  /** Opt in to the page's file query parameter, hash, and Back/Forward history. */
  history?: boolean;
  updateTitle?: boolean;
  /** Set false to disable persistence; use different keys for independent instances. */
  storageKey?: string | false;
  /** Initial override; defaults to the saved choice, then the browser preference. */
  theme?: Theme;
  htmlEnabled?: boolean;
  onNavigate?(file: string, hash: string): void;
  onDocumentChange?(document: MarkdownDocument | null): void;
  onError?(error: Error): void;
}

export interface NoPainMDViewer {
  readonly element: HTMLElement;
  readonly ready: Promise<void>;
  open(file: string, hash?: string): Promise<void>;
  reload(): Promise<void>;
  setTheme(theme: Theme): Promise<void>;
  setHTMLEnabled(enabled: boolean): Promise<void>;
  destroy(): void;
}
