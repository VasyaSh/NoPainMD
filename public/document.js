import { headingId } from './headings.js';
import { textLinks } from './text-links.js';
import { svgNamespace, svgTags, svgAttributes, svgAttributeSanitizer } from './svg.js';

const createPurifier = window.DOMPurify;
const allowedTags = ['p', 'br', 'wbr', 'hr', 'div', 'span', 'blockquote', 'pre', 'code', 'b', 'strong', 'i', 'em', 's', 'del', 'u', 'ins', 'sub', 'sup', 'kbd', 'samp', 'var', 'mark', 'small', 'abbr', 'q', 'cite', 'a', 'img', 'figure', 'figcaption', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'details', 'summary', 'input'];
const allowedAttributes = ['href', 'src', 'alt', 'title', 'target', 'rel', 'width', 'height', 'colspan', 'rowspan', 'scope', 'start', 'reversed', 'open', 'type', 'checked', 'disabled'];

function fileURL(file, hash = '') {
  return `/?file=${encodeURIComponent(file).replaceAll('%2F', '/').replaceAll('%3A', ':')}${hash}`;
}

function nativePath(url, separator) {
  let file = decodeURIComponent(url.pathname);
  if (separator === '\\') {
    file = file.replace(/^\/([a-z]:\/)/iu, '$1').replaceAll('/', '\\');
    if (url.hostname) file = `\\\\${url.hostname}${file}`;
  } else if (url.hostname) return null;
  return file;
}

function relativeDocument(value, doc) {
  const absolute = path => /^[\\/]|^[a-z][a-z\d+.-]*:/iu.test(path);
  if (!value || /^[#?]/u.test(value) || absolute(value)) return null;
  try {
    const encodedPath = value.split(/[?#]/u)[0];
    const decodedPath = decodeURIComponent(encodedPath);
    if (absolute(decodedPath) || decodedPath.includes('\0')) return null;
    const path = doc.separator === '\\' ? decodedPath.replaceAll('\\', '/') : decodedPath;
    // Decode before normalizing dot segments and separators.
    const url = new URL(path.split('/').map(encodeURIComponent).join('/') + value.slice(encodedPath.length), doc.sourceURL);
    const file = url.protocol === 'file:' && nativePath(url, doc.separator);
    return file && /\.(?:md|markdown)$/iu.test(file) ? { file, hash: url.hash } : null;
  } catch { return null; }
}

// Resolve URLs before final sanitizer checks; defer link conversion to indexing.
export function resourceURL(value, doc, image = false) {
  value = value.trim();
  if (!value) return null;
  if (!image && value.startsWith('#')) return value;
  if (!image && value.startsWith('/?') && new URL(value, location.origin).searchParams.has('file')) return value;
  if (image && value.startsWith('/api/image?')) return value;
  if (image && /^data:image\/(?:png|gif|jpeg|webp|avif);base64,/iu.test(value)) return value;
  try {
    const target = doc.separator === '\\' && /^[a-z]:[\\/]/iu.test(value) ? `file:///${value.replaceAll('\\', '/')}` : value;
    const url = new URL(target, value.startsWith('//') ? location.origin : doc.sourceURL);
    if (['http:', 'https:'].includes(url.protocol)) return image ? url.href : value;
    if (!image && ['ftp:', 'ftps:', 'mailto:', 'tel:'].includes(url.protocol)) return value;
    if (url.protocol !== 'file:') return null;
    if (!image) return value;
    const file = nativePath(url, doc.separator);
    return file ? `/api/image?${new URLSearchParams({ file, token: doc.imageToken })}` : null;
  } catch { return null; }
}

function headingText(element) {
  const copy = element.cloneNode(true);
  for (const br of copy.querySelectorAll('br')) br.replaceWith(' ');
  for (const img of copy.querySelectorAll('img')) img.replaceWith(img.getAttribute('alt') || '');
  return copy.textContent.replace(/\s+/gu, ' ').trim();
}

export function prepareDocument(doc) {
  const purifier = createPurifier(window);
  if (!purifier.isSupported) throw new Error('This browser cannot safely render documents.');
  const markers = new Map(Object.entries(doc.markers || {}));
  const sanitizeSVGAttribute = svgAttributeSanitizer();
  purifier.addHook('uponSanitizeAttribute', (node, data) => {
    if (sanitizeSVGAttribute(node, data)) return;
    if (!allowedAttributes.includes(data.attrName) && data.attrName !== 'data-nopainmd') data.keepAttr = false;
    if (data.attrName === 'data-nopainmd') {
      const marker = markers.get(data.attrValue);
      data.forceKeepAttr = Boolean(marker && ((marker.kind === 'heading' && /^H[1-6]$/u.test(node.nodeName)) || (marker.kind === 'mermaid' && node.nodeName === 'DIV')));
    }
    if (data.attrName === 'href' || data.attrName === 'src') {
      const image = data.attrName === 'src';
      const value = ((!image && node.nodeName === 'A') || (image && node.nodeName === 'IMG')) && resourceURL(data.attrValue, doc, image);
      if (value) data.attrValue = value; else data.keepAttr = false;
    }
    if (data.attrName === 'target' && data.attrValue !== '_blank') data.keepAttr = false;
  });
  purifier.addHook('afterSanitizeAttributes', node => {
    if (node.nodeName === 'A') node.setAttribute('rel', 'noopener noreferrer');
  });
  // Insert this fragment directly; never reparse it.
  const fragment = purifier.sanitize(doc.html, {
    ALLOWED_TAGS: [...allowedTags, ...svgTags], ALLOWED_ATTR: [...allowedAttributes, ...svgAttributes],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, RETURN_DOM_FRAGMENT: true,
  });
  for (const element of fragment.querySelectorAll('*')) {
    if (element.namespaceURI !== svgNamespace && !allowedTags.includes(element.localName)) element.remove();
    else if (element.namespaceURI === svgNamespace && element.localName === 'svg' && !element.parentElement?.closest('svg')) element.classList.add('embedded-svg');
  }
  // Update sanitized links in place to preserve document state.
  const links = [...fragment.querySelectorAll('a[href]')].flatMap(element => {
    const original = element.getAttribute('href');
    const target = relativeDocument(original, doc);
    return target ? [{ element, original, ...target }] : [];
  });
  const bareLinks = [];
  function updateLinks(unfilteredNodes) {
    const key = file => doc.separator === '\\' ? file.toLowerCase() : file;
    const files = new Map([...unfilteredNodes.values()].filter(node => node.type === 'file').map(node => [key(node.path), node.path]));
    for (const link of links) {
      const target = files.get(key(link.file));
      link.element.setAttribute('href', target ? fileURL(target, link.hash) : link.original);
    }
    for (const link of bareLinks) {
      const target = files.get(key(link.file));
      if (target) {
        if (link.element.nodeType === Node.TEXT_NODE) {
          const anchor = document.createElement('a');
          anchor.textContent = link.text; anchor.setAttribute('rel', 'noopener noreferrer');
          link.element.replaceWith(anchor); link.element = anchor;
        }
        link.element.setAttribute('href', fileURL(target, link.hash));
      } else if (link.element.nodeType !== Node.TEXT_NODE) {
        const text = document.createTextNode(link.text);
        link.element.replaceWith(text); link.element = text;
      }
    }
  }
  const trusted = new WeakMap();
  for (const node of fragment.querySelectorAll('[data-nopainmd]')) {
    const marker = markers.get(node.getAttribute('data-nopainmd'));
    node.removeAttribute('data-nopainmd');
    if (!marker) continue;
    trusted.set(node, marker);
    if (marker.kind === 'mermaid') {
      node.className = 'mermaid-block';
      node.querySelector('pre')?.classList.add('mermaid-source');
    }
  }
  for (const input of fragment.querySelectorAll('input')) {
    if (input.type !== 'checkbox') input.remove(); else input.disabled = true;
  }
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest('a, pre, kbd, samp, svg, .mermaid-block') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const node of textNodes) {
    const code = node.parentElement?.closest('code');
    const value = node.data.trim();
    // Inline code must contain only a complete relative path.
    const matches = code
      ? (code.textContent === node.data && relativeDocument(value, doc) ? [{ index: node.data.indexOf(value), text: value }] : [])
      : textLinks(node.data);
    if (!matches.length) continue;
    const replacement = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      replacement.append(document.createTextNode(node.data.slice(offset, match.index)));
      let element = document.createTextNode(match.text);
      if (match.href) {
        element = document.createElement('a');
        element.textContent = match.text; element.setAttribute('href', match.href);
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noopener noreferrer');
      } else {
        const target = relativeDocument(match.text, doc);
        if (target) bareLinks.push({ element, text: match.text, ...target });
      }
      replacement.append(element);
      offset = match.index + match.text.length;
    }
    replacement.append(document.createTextNode(node.data.slice(offset)));
    node.replaceWith(replacement);
  }
  const elements = [...fragment.querySelectorAll('h1, h2, h3, h4, h5, h6')];
  const h1Count = elements.filter(node => node.tagName === 'H1').length;
  const used = new Set();
  const headings = [];
  let title;
  for (const element of elements) {
    const text = headingText(element);
    title ??= text;
    element.id = headingId(text, used);
    const level = Number(element.tagName.slice(1));
    if (trusted.get(element)?.outline && !(level === 1 && h1Count === 1)) headings.push({ text, id: element.id, level });
  }
  return { fragment, headings, title: title ?? doc.name, updateLinks };
}
