/**
 * Frozen contract HTML -> a flat list of blocks for native rendering (the app has no WebView).
 *
 * Covers what the template engine emits from its markdown-ish source (# headings, **bold**,
 * - lists, paragraphs) plus the damage thumbnails and signature slot it injects. Unknown
 * containers are walked through, so extra wrappers never lose text; script/style are ignored.
 */
import { PHOTO_TOKEN_PREFIX, SIGNATURE_TOKEN } from './contract';
import { parseHtml, type HtmlElement, type HtmlNode } from './html/parse';

export interface TextSpan {
  text: string;
  bold?: true;
  italic?: true;
}

export type ContractImageSource =
  /** `annotated` = the photo was drawn inside an SVG with damage markers. */
  | { kind: 'photo'; photoId: string; annotated: boolean }
  | { kind: 'data'; uri: string };

export interface ContractListItem {
  spans: TextSpan[];
  /** 0 for top-level items, +1 per nested list. */
  depth: number;
  images: ContractImageSource[];
}

export type ContractBlock =
  | { type: 'heading'; level: 1 | 2 | 3; spans: TextSpan[] }
  | { type: 'paragraph'; spans: TextSpan[] }
  | { type: 'list'; ordered: boolean; items: ContractListItem[] }
  | { type: 'image'; source: ContractImageSource; alt: string }
  | { type: 'signature' }
  | { type: 'rule' };

type Media = { type: 'image'; source: ContractImageSource; alt: string } | { type: 'signature' };
type InlineItem = { kind: 'span'; span: TextSpan } | { kind: 'media'; media: Media };
interface Style {
  bold: boolean;
  italic: boolean;
}

const SKIP = new Set(['head', 'script', 'style', 'title', 'template', 'noscript', 'meta', 'link', 'button', 'input']);
const INLINE = new Set([
  'a', 'abbr', 'b', 'cite', 'code', 'del', 'em', 'font', 'i', 'ins', 'kbd', 'label', 'mark', 'q', 's', 'samp',
  'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var',
]);
const HEADINGS: Record<string, 1 | 2 | 3> = { h1: 1, h2: 2, h3: 3, h4: 3, h5: 3, h6: 3 };
/** Stand-ins while whitespace is collapsed: <br> always breaks, a block edge breaks once. */
const BREAK = '\u2028';
const SOFT_BREAK = '\u2029';

function isBold(el: HtmlElement): boolean {
  if (el.name === 'strong' || el.name === 'b') return true;
  const weight = /font-weight\s*:\s*(bold|[6-9]00)/i.exec(el.attrs.style ?? '');
  return weight !== null;
}

function isItalic(el: HtmlElement): boolean {
  return el.name === 'em' || el.name === 'i' || /font-style\s*:\s*italic/i.test(el.attrs.style ?? '');
}

function mediaFromImg(el: HtmlElement): Media | null {
  const src = (el.attrs.src ?? '').trim();
  const alt = el.attrs.alt ?? '';
  if (src === SIGNATURE_TOKEN) return { type: 'signature' };
  if (src.startsWith(PHOTO_TOKEN_PREFIX)) {
    return { type: 'image', alt, source: { kind: 'photo', photoId: src.slice(PHOTO_TOKEN_PREFIX.length), annotated: false } };
  }
  if (/^data:image\//i.test(src)) return { type: 'image', alt, source: { kind: 'data', uri: src } };
  return null;
}

/** An inline SVG counts as a photo only if it draws a contract photo (thumbnail + markers). */
function mediaFromSvg(el: HtmlElement): Media | null {
  const stack: HtmlNode[] = [...el.children];
  while (stack.length) {
    const node = stack.shift()!;
    if (node.type !== 'element') continue;
    if (node.name === 'image') {
      const href = (node.attrs.href ?? node.attrs['xlink:href'] ?? '').trim();
      if (href === SIGNATURE_TOKEN) return { type: 'signature' };
      if (href.startsWith(PHOTO_TOKEN_PREFIX)) {
        const alt = el.attrs['aria-label'] ?? '';
        return { type: 'image', alt, source: { kind: 'photo', photoId: href.slice(PHOTO_TOKEN_PREFIX.length), annotated: true } };
      }
    }
    stack.push(...node.children);
  }
  return null;
}

function collectInline(nodes: HtmlNode[], style: Style, out: InlineItem[], skipLists = false): void {
  for (const node of nodes) {
    if (node.type === 'text') {
      out.push({ kind: 'span', span: withStyle(node.text, style) });
      continue;
    }
    const el = node;
    if (SKIP.has(el.name) || (skipLists && (el.name === 'ul' || el.name === 'ol'))) continue;
    if (el.name === 'br') {
      out.push({ kind: 'span', span: withStyle(BREAK, style) });
    } else if (el.name === 'img') {
      const media = mediaFromImg(el);
      if (media) out.push({ kind: 'media', media });
    } else if (el.name === 'svg') {
      const media = mediaFromSvg(el);
      if (media) out.push({ kind: 'media', media });
    } else {
      const block = !INLINE.has(el.name);
      if (block) out.push({ kind: 'span', span: withStyle(SOFT_BREAK, style) });
      const next = { bold: style.bold || isBold(el), italic: style.italic || isItalic(el) };
      collectInline(el.children, next, out, skipLists);
      if (block) out.push({ kind: 'span', span: withStyle(SOFT_BREAK, style) });
    }
  }
}

function withStyle(text: string, style: Style): TextSpan {
  const span: TextSpan = { text };
  if (style.bold) span.bold = true;
  if (style.italic) span.italic = true;
  return span;
}

/** Collapses whitespace like a browser, keeps <br> as "\n", trims, merges equal-style runs. */
export function normalizeSpans(spans: TextSpan[]): TextSpan[] {
  const out: TextSpan[] = [];
  let lastChar = '';
  const emit = (ch: string, like: TextSpan) => {
    const prev = out[out.length - 1];
    if (prev && prev.bold === like.bold && prev.italic === like.italic) prev.text += ch;
    else out.push({ text: ch, ...(like.bold ? { bold: true } : {}), ...(like.italic ? { italic: true } : {}) });
    lastChar = ch;
  };
  for (const span of spans) {
    for (const ch of span.text.replace(/[ \t\r\n\f]+/g, ' ')) {
      if (ch === ' ') {
        if (lastChar !== '' && lastChar !== ' ' && lastChar !== '\n') emit(' ', span);
      } else if (ch === BREAK || ch === SOFT_BREAK) {
        if (lastChar === '' || (ch === SOFT_BREAK && lastChar === '\n')) continue;
        const prev = out[out.length - 1];
        if (prev.text.endsWith(' ')) prev.text = prev.text.slice(0, -1);
        emit('\n', span);
      } else {
        emit(ch, span);
      }
    }
  }
  for (let i = out.length - 1; i >= 0; i--) {
    out[i].text = out[i].text.replace(/[ \n]+$/, '');
    if (out[i].text !== '') break;
  }
  return out.filter((s) => s.text !== '');
}

function mediaBlock(media: Media): ContractBlock {
  return media.type === 'signature' ? { type: 'signature' } : media;
}

/** Splits an inline run into text blocks (made by `make`) and media blocks, in document order. */
function emitInline(items: InlineItem[], make: (spans: TextSpan[]) => ContractBlock, into: ContractBlock[]): void {
  let run: TextSpan[] = [];
  const flush = () => {
    const spans = normalizeSpans(run);
    if (spans.length) into.push(make(spans));
    run = [];
  };
  for (const item of items) {
    if (item.kind === 'span') run.push(item.span);
    else {
      flush();
      into.push(mediaBlock(item.media));
    }
  }
  flush();
}

const PLAIN: Style = { bold: false, italic: false };

function buildList(list: HtmlElement, depth: number, items: ContractListItem[], hoisted: ContractBlock[]): void {
  for (const child of list.children) {
    if (child.type !== 'element') continue;
    if (child.name === 'ul' || child.name === 'ol') {
      buildList(child, depth + 1, items, hoisted);
      continue;
    }
    const inline: InlineItem[] = [];
    collectInline(child.name === 'li' ? child.children : [child], PLAIN, inline, true);
    const images: ContractImageSource[] = [];
    const spans: TextSpan[] = [];
    for (const it of inline) {
      if (it.kind === 'span') spans.push(it.span);
      else if (it.media.type === 'image') images.push(it.media.source);
      else hoisted.push({ type: 'signature' });
    }
    const normalized = normalizeSpans(spans);
    if (normalized.length || images.length) items.push({ spans: normalized, depth, images });
    for (const nested of child.children) {
      if (nested.type === 'element' && (nested.name === 'ul' || nested.name === 'ol')) {
        buildList(nested, depth + 1, items, hoisted);
      }
    }
  }
}

function walkBlocks(nodes: HtmlNode[], out: ContractBlock[]): void {
  let pending: InlineItem[] = [];
  const flush = () => {
    emitInline(pending, (spans) => ({ type: 'paragraph', spans }), out);
    pending = [];
  };

  for (const node of nodes) {
    if (node.type === 'text') {
      pending.push({ kind: 'span', span: { text: node.text } });
      continue;
    }
    const el = node;
    if (SKIP.has(el.name)) continue;
    if (INLINE.has(el.name) || el.name === 'br' || el.name === 'img' || el.name === 'svg') {
      collectInline([el], PLAIN, pending);
      continue;
    }
    flush();
    const level = HEADINGS[el.name];
    if (level) {
      const inline: InlineItem[] = [];
      collectInline(el.children, PLAIN, inline);
      emitInline(inline, (spans) => ({ type: 'heading', level, spans }), out);
    } else if (el.name === 'p') {
      const inline: InlineItem[] = [];
      collectInline(el.children, PLAIN, inline);
      emitInline(inline, (spans) => ({ type: 'paragraph', spans }), out);
    } else if (el.name === 'ul' || el.name === 'ol') {
      const items: ContractListItem[] = [];
      const hoisted: ContractBlock[] = [];
      buildList(el, 0, items, hoisted);
      if (items.length) out.push({ type: 'list', ordered: el.name === 'ol', items });
      out.push(...hoisted);
    } else if (el.name === 'hr') {
      out.push({ type: 'rule' });
    } else if (el.name === 'table') {
      walkTable(el, out);
    } else {
      walkBlocks(el.children, out);
    }
  }
  flush();
}

/** Each table row becomes one paragraph, cells joined with " · ". */
function walkTable(table: HtmlElement, out: ContractBlock[]): void {
  const rows: HtmlElement[] = [];
  const find = (el: HtmlElement) => {
    for (const c of el.children) {
      if (c.type !== 'element') continue;
      if (c.name === 'tr') rows.push(c);
      else if (c.name !== 'table') find(c);
    }
  };
  find(table);
  for (const row of rows) {
    const inline: InlineItem[] = [];
    let first = true;
    for (const cell of row.children) {
      if (cell.type !== 'element' || (cell.name !== 'td' && cell.name !== 'th')) continue;
      const cellItems: InlineItem[] = [];
      collectInline(cell.children, { bold: cell.name === 'th', italic: false }, cellItems);
      const hasText = cellItems.some((i) => i.kind === 'media' || i.span.text.trim() !== '');
      if (!hasText) continue;
      if (!first) inline.push({ kind: 'span', span: { text: ' · ' } });
      inline.push(...cellItems);
      first = false;
    }
    emitInline(inline, (spans) => ({ type: 'paragraph', spans }), out);
  }
}

export function contractHtmlToBlocks(html: string): ContractBlock[] {
  const out: ContractBlock[] = [];
  walkBlocks(parseHtml(html).children, out);
  return out;
}

/** Plain text of a span list (accessibility labels, search). */
export function spansToText(spans: TextSpan[]): string {
  return spans.map((s) => s.text).join('');
}
