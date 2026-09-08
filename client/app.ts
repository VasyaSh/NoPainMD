import template from '../public/viewer.html';
import { startViewer } from './runtime.js';
import { createHTTPSource } from './source.js';

document.body.innerHTML = template;
const viewer = startViewer(document.documentElement, document.body, { history: true, updateTitle: true }, createHTTPSource(), () => { window.print(); });
window.addEventListener('pagehide', event => { if (!event.persisted) viewer.destroy(); });
