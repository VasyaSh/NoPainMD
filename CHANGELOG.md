# Changelog

## 0.1.14

- Migrated the CLI, server, viewer, and shared modules to strict TypeScript with exported type declarations.
- Added type-aware ESLint checks with zero warnings allowed.
- Added browser exports `mountNoPainMD` and `createHTTPSource`, plus separate Node APIs through `nopainmd/server`.
- Made the complete viewer embeddable with Shadow DOM, multiple instances, custom data sources, and configurable preference storage.
- Added navigation callbacks, programmatic controls, optional page history and title updates, cancellation, and safe repeated teardown.
- Moved published code and assets into `dist`, bundling viewer styles, Mermaid, and DOMPurify alongside declarations and font assets.
- Added optional read-error diagnostics through `NODE_DEBUG=nopainmd`, including indexing workers.
- Fixed HTML-off rendering: raw tags, comments, and SVG remain literal; Markdown images and Mermaid diagrams still render.
- Applied monospace fonts to code blocks and preformatted text, including ASCII diagrams and printed output.
- Added an environment-variable reference, commented `.env.example`, and embedding API, architecture, asset, and styling documentation.
- Expanded `.gitignore` to exclude compiled output, coverage, test reports, caches, and local settings.
- Added GitHub Actions checks on Node.js 22, 24, and 26, plus Chromium tests, package smoke tests, and downloadable reports.
- Enforced 95% line, 80% branch, and 100% function coverage for the CLI, server, and shared modules.
- Expanded tests for embedding, package imports and types, HTML rendering, HTTP and filesystem edge cases, port retries, shutdown failures, and worker recovery.

## 0.1.13

- Fixed multiline embedded SVG rendering inside HTML wrappers, including drawings containing blank lines.
- Added `<figure>` and `<figcaption>` support and figure spacing.
- Preserved supported SVG display styles and solid background colors during sanitization.
- Added subtle backgrounds and padding to inline code.
- Reworked the README with a friendly introduction, feature summary and screenshot, and separate npm and cloned-repository installation options.
- Added Git and npm ignore rules, moved development notes into `AGENTS.md`, and excluded those notes from distribution.
- Removed the unused favicon prompt asset and its package entry.

## 0.1.12

- Sorted files and directories together alphabetically at every tree level.

## 0.1.11

- Added sanitized embedded SVG rendering with isolated IDs, local references, theme support, and printing.
- Added `NOPAINMD_BASE_DIR` to select the directory to browse while keeping `.env` in the launch directory.
- Changed the light-theme paper color to `#fefefc`.
- Updated package metadata, GitHub links, and the MIT copyright holder; simplified code comments and consolidated tests.

## 0.1.10

- Converted standalone relative Markdown paths inside inline code into internal links while preserving code formatting.

## 0.1.9

- Converted bare relative Markdown paths into internal links using the full, unfiltered tree.
- Automatically linked fully qualified HTTP, HTTPS, FTP, FTPS, mailto, and tel URLs in plain text, opening them in new tabs.
- Kept automatic linking separate from HTML attributes, existing links, and fenced code.
- Limited Quick Search to 256px wide.

## 0.1.8

- Resolved relative Markdown and HTML document links against the full indexed tree, allowing any number of parent-directory steps and preserving heading fragments.

## 0.1.7

- Highlighted the deepest visible ancestor when a collapsed directory hides the selected file.

## 0.1.6

- Added case-insensitive filename search with automatic expansion of matching branches and independent filtered-tree state.
- Preserved search across Reload and expanded opened search results in the unfiltered tree.

## 0.1.5

- Added sanitized HTML rendering with bundled DOMPurify and the `NOPAINMD_HTML_ENABLED` setting.
- Added a persistent HTML toggle with green/red indicators and immediate document updates that preserve scroll position where possible.

## 0.1.4

- Added case-insensitive `.markdown` support alongside `.md` throughout indexing and navigation.

## 0.1.3

- Added the sidebar copyright footer and an HTML copyright comment mentioning the MIT license.

## 0.1.2

- Applied the node limit only to entries included in the fully expanded tree, counting files and their ancestor directories together.
- Unified CLI and UI limit notices, added automatic expansion of single-directory chains, and replaced the Print label with a printer icon.

## 0.1.1

- Updated versioned installation examples.

## 0.1.0

- Introduced the local Markdown browser with recursive indexing, a file tree, heading navigation, absolute document URLs, and external-file handling.
- Added persistent themes and sidebar width, state-preserving Reload, configurable indexing limits, and tolerant read-error handling with CLI summaries.
- Included Mermaid diagrams, document-only printing, bundled Open Sans fonts, and the `.md` favicon.
- Supported global installation and foreground `npx` usage, Ctrl+C shutdown, configurable host and port, busy-port prompts, and font settings.
