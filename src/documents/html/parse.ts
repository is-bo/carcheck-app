/**
 * A small, forgiving HTML tree builder for the contract subset (no scripts, no forms).
 * Enough to turn frozen contract HTML into native blocks; not a general HTML5 parser.
 */

export interface HtmlElement {
  type: 'element';
  name: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}
export interface HtmlText {
  type: 'text';
  text: string;
}
export type HtmlNode = HtmlElement | HtmlText;

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);
/** Elements whose content is raw text, never markup. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
/** Opening one of these implicitly closes an open element of the same name (p, li). */
const SELF_NESTING_CLOSES = new Set(['p', 'li', 'tr', 'td', 'th', 'option']);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', euro: '€',
  pound: '£', copy: '©', reg: '®', deg: '°', times: '×', shy: '',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? all;
  });
}

const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(ATTR)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { type: 'element', name: '#root', attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const top = () => stack[stack.length - 1];
  const tag = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<\/\s*([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;

  let last = 0;
  const pushText = (raw: string) => {
    if (raw) top().children.push({ type: 'text', text: decodeEntities(raw) });
  };

  let m: RegExpExecArray | null;
  while ((m = tag.exec(html)) !== null) {
    pushText(html.slice(last, m.index));
    last = tag.lastIndex;
    const [, closeName, openName, attrSource, selfClose] = m;

    if (closeName) {
      const name = closeName.toLowerCase();
      const idx = stack.map((e) => e.name).lastIndexOf(name);
      if (idx > 0) stack.length = idx;
      continue;
    }
    if (!openName) continue; // comment, doctype, CDATA, processing instruction

    const name = openName.toLowerCase();
    if (SELF_NESTING_CLOSES.has(name) && top().name === name) stack.pop();
    const el: HtmlElement = { type: 'element', name, attrs: parseAttrs(attrSource ?? ''), children: [] };
    top().children.push(el);
    if (VOID_ELEMENTS.has(name) || selfClose) continue;

    if (RAW_TEXT.has(name)) {
      const end = new RegExp(`</\\s*${name}\\s*>`, 'ig');
      end.lastIndex = last;
      const close = end.exec(html);
      const stop = close ? close.index : html.length;
      el.children.push({ type: 'text', text: html.slice(last, stop) });
      last = close ? end.lastIndex : html.length;
      tag.lastIndex = last;
      continue;
    }
    stack.push(el);
  }
  pushText(html.slice(last));
  return root;
}
