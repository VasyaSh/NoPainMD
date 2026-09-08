import type { UponSanitizeAttributeHookEvent } from 'dompurify';

interface SVGScope { ids: Map<string, string>; elements: WeakMap<Element, string> }
export const svgNamespace = 'http://www.w3.org/2000/svg';
export const svgTags = ['svg', 'g', 'a', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textpath', 'title', 'desc', 'defs', 'symbol', 'use', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'marker', 'pattern', 'filter', 'fegaussianblur', 'feoffset', 'feblend', 'fecolormatrix', 'fecomposite', 'femerge', 'femergenode', 'feflood', 'fedropshadow'];
const styles = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity', 'color', 'background-color', 'display', 'stop-color', 'stop-opacity', 'flood-color', 'flood-opacity', 'font-size', 'font-style', 'font-weight', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'baseline-shift', 'letter-spacing', 'word-spacing', 'text-decoration', 'clip-path', 'clip-rule', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end', 'paint-order', 'vector-effect', 'shape-rendering', 'text-rendering']);
export const svgAttributes = ['id', 'style', 'viewbox', 'preserveaspectratio', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'dx', 'dy', 'points', 'transform', 'pathlength', 'textlength', 'lengthadjust', 'rotate', 'href', 'xlink:href', 'offset', 'fx', 'fy', 'fr', 'gradientunits', 'gradienttransform', 'spreadmethod', 'clippathunits', 'maskunits', 'maskcontentunits', 'markerwidth', 'markerheight', 'markerunits', 'refx', 'refy', 'orient', 'patternunits', 'patterncontentunits', 'patterntransform', 'filterunits', 'primitiveunits', 'in', 'in2', 'result', 'stddeviation', 'mode', 'type', 'values', 'operator', 'k1', 'k2', 'k3', 'k4', ...styles];
const attributes = new Set(svgAttributes);
const paints = new Set(['fill', 'stroke', 'color', 'background-color', 'stop-color', 'flood-color']);
const references = new Set(['clip-path', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end']);
const hrefTags = new Set(['use', 'textpath', 'lineargradient', 'radialgradient', 'pattern']);

export function svgAttributeSanitizer(): (node: Element, data: UponSanitizeAttributeHookEvent) => boolean {
  const scopes = new WeakMap<SVGSVGElement, SVGScope>();
  let elementsCount = 0;
  function scopeFor(node: Element) {
    let root = node.closest('svg');
    if (!root) return null;
    for (let parent = root.parentElement?.closest('svg'); parent; parent = root.parentElement?.closest('svg')) root = parent;
    if (!scopes.has(root)) {
      // Keep references inside their SVG, with unique IDs across diagrams.
      const prefix = `nopainmd-svg-${crypto.getRandomValues(new Uint32Array(4)).join('-')}-`;
      const ids = new Map<string, string>();
      const elements = new WeakMap<Element, string>();
      for (const element of [root, ...root.querySelectorAll('[id]')]) {
        if (element.namespaceURI !== svgNamespace || !svgTags.includes(element.localName.toLowerCase()) || !element.id) continue;
        const id = prefix + elementsCount++;
        if (!ids.has(element.id)) ids.set(element.id, id);
        elements.set(element, id);
      }
      scopes.set(root, { ids, elements });
    }
    return scopes.get(root);
  }
  function valueFor(name: string, value: string, scope: SVGScope): string | null {
    value = value.trim();
    if (paints.has(name) || references.has(name)) {
      const reference = name !== 'background-color' && /^url\(\s*(['"]?)#([\w.:-]+)\1\s*\)$/iu.exec(value);
      if (reference) {
        const id = scope.ids.get(reference[2] ?? '');
        return id ? `url(#${id})` : null;
      }
      if (references.has(name)) return value === 'none' ? value : null;
      if (/^(none|inherit|currentcolor|context-fill|context-stroke)$/iu.test(value)) return value;
      return !/[\\<>]|(?:url|var|attr)\s*\(/iu.test(value) && CSS.supports('color', value) ? value : null;
    }
    return /[\\<>@]|(?:url|var|attr)\s*\(/iu.test(value) ? null : value;
  }
  return (node, data) => {
    if (node.namespaceURI !== svgNamespace) return false;
    const scope = scopeFor(node);
    let value: string | null | undefined = null;
    if (scope && attributes.has(data.attrName)) {
      if (data.attrName === 'id') value = scope.elements.get(node);
      else if (data.attrName === 'href' || data.attrName === 'xlink:href') {
        const id = data.attrValue.trim();
        if (hrefTags.has(node.localName.toLowerCase()) && id.startsWith('#') && scope.ids.has(id.slice(1))) value = `#${scope.ids.get(id.slice(1))}`;
      } else if (data.attrName === 'style') {
        const source = document.createElement('span').style;
        const clean = document.createElement('span').style;
        source.cssText = data.attrValue;
        for (const property of source) {
          if (!styles.has(property)) continue;
          const safe = valueFor(property, source.getPropertyValue(property), scope);
          if (safe) clean.setProperty(property, safe);
        }
        value = clean.cssText || null;
      } else value = valueFor(data.attrName, data.attrValue, scope);
    }
    data.keepAttr = value != null;
    if (value != null) data.attrValue = value;
    return true;
  };
}
