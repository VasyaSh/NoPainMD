# NoPainMD

Developers are working with more Markdown than ever. AI tools and agents often
take their instructions from `.md` files, and many use terminal interfaces,
so we're spending more time in the console too. NoPainMD makes reading all those
files a little easier: start it from your terminal and get instant, convenient
access to your workspace's Markdown files in a clean web interface.

Built with Node.js and vanilla JavaScript/CSS. Requires Node.js 22 or newer.

## Features

Find `.md` and `.markdown` files in a searchable directory tree, jump to headings,
and follow links between documents.
View Mermaid diagrams and embedded SVG, toggle HTML rendering, and read comfortably
with light or dark themes and a resizable sidebar.
Refresh files without losing your place, and print documents without the
surrounding navigation or controls.

![NoPainMD features](public/features.png)

## Get Started

The npm package is named `nopainmd` and is published by
[`vasyash`](https://www.npmjs.com/~vasyash). Install it globally from npm:

```sh
npm install -g nopainmd
```

Alternatively, install it globally from a cloned Git repository:

```sh
git clone https://github.com/VasyaSh/NoPainMD.git
cd NoPainMD
npm ci
npm pack
npm install -g ./nopainmd-0.1.13.tgz
```

`npm pack` builds and bundles the browser assets automatically. If the version
changes, use the `.tgz` filename printed by that command.

After either installation method, launch it from the directory you want to browse:

```sh
cd /path/to/your/documents
nopainmd
```

`npx nopainmd` also runs it without a global installation.

If the requested port is busy, an interactive terminal prompts for another port.
Press `Enter` to let the OS choose an available port. Noninteractive startup fails
with instructions instead; use `--port 0` to request an available port explicitly.
Browser-launch failures leave the URL in the terminal for manual opening.

## Licenses and assets

Application code: MIT, see `LICENSE`. Bundled historical Open Sans fonts:
Apache 2.0, see `public/fonts/LICENSE.txt` and `public/fonts/NOTICE.txt`.
Mermaid's license is copied alongside its bundled browser modules; dependency
license notices remain in those modules.
DOMPurify is distributed under its Apache 2.0 option; its license is included at
`public/vendor/dompurify/LICENSE` and its copyright notice remains in the bundle.

The browser tab icon shows `.md` in white on a black disc, making NoPainMD easy
to spot among your tabs.
