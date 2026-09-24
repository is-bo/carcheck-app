/**
 * Safe contract template renderer.
 *
 * Syntax (markdown-ish, nothing else): `# `/`## `/`### ` headings, `**bold**`, `- ` or `* `
 * bullets, `1. ` numbered items, blank line = new paragraph, single newline = line break, and
 * `{{variable}}` from the registry. All template text and every value is HTML-escaped; only
 * registry-built blocks (damage list, signature) emit markup. Unknown variables render visibly
 * as "[missing: key]" and are reported, so they cannot slip through to a signature.
 *
 * The HTML is the frozen contract content; `blocks` is the same content structured for native
 * rendering on screen.
 */
import type { RentalContext } from './context';
import { escapeHtml } from './format';
import { getContractVariable, resolveAllVariables } from './variables';

export type ContractInline =
  | { kind: 'text'; text: string; bold: boolean }
  | { kind: 'variable'; key: string; value: string | null; known: boolean; bold: boolean };

export type ContractBlock =
  | { type: 'heading'; level: 1 | 2 | 3; content: ContractInline[] }
  | { type: 'paragraph'; lines: ContractInline[][] }
  | { type: 'list'; ordered: boolean; items: ContractInline[][] }
  /** A block variable alone in its paragraph (existing-damage photos, signature). */
  | { type: 'variable'; key: string };

export interface ContractRenderResult {
  /**
   * Body fragment: h1-h3, p, ul/ol/li, strong, br, plus the registry's svg/img blocks. Viewers
   * wrap it in their own container. External references: only carcheck-photo:/carcheck-signature:.
   */
  html: string;
  blocks: ContractBlock[];
  /** Text value of every registered variable (the signed contract's variables snapshot). */
  variables: Record<string, string | null>;
  /** Variables the template uses, in first-use order. */
  usedKeys: string[];
  /** Used but not in the registry: rendered as [missing: key]. */
  unknownKeys: string[];
  /** Used, known, but without a value: rendered as an em dash. */
  emptyKeys: string[];
}

type RawInline = { kind: 'text'; text: string; bold: boolean } | { kind: 'var'; key: string; bold: boolean };

type RawBlock =
  | { type: 'heading'; level: 1 | 2 | 3; line: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'list'; ordered: boolean; items: string[] };

const VAR_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const ALONE_VAR_RE = /^\{\{\s*([^{}]*?)\s*\}\}$/;

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

function parseStructure(body: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  const open: { paragraph: string[] | null; list: { ordered: boolean; items: string[] } | null } = {
    paragraph: null,
    list: null,
  };
  const flushParagraph = () => {
    if (open.paragraph) blocks.push({ type: 'paragraph', lines: open.paragraph });
    open.paragraph = null;
  };
  const flushList = () => {
    if (open.list) blocks.push({ type: 'list', ordered: open.list.ordered, items: open.list.items });
    open.list = null;
  };

  for (const rawLine of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (line === '') {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, line: heading[2] });
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line) ?? /^\d{1,3}[.)]\s+(.*)$/.exec(line);
    if (item) {
      flushParagraph();
      const ordered = !/^[-*]/.test(line);
      if (open.list && open.list.ordered !== ordered) flushList();
      open.list ??= { ordered, items: [] };
      open.list.items.push(item[1]);
      continue;
    }
    flushList();
    open.paragraph ??= [];
    open.paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Splits a line into text and variables; `**` toggles bold, an unpaired last `**` stays literal. */
function tokenizeLine(line: string): RawInline[] {
  const parts: ({ t: 'text'; s: string } | { t: 'var'; key: string })[] = [];
  let last = 0;
  for (const m of line.matchAll(VAR_RE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ t: 'text', s: line.slice(last, at) });
    parts.push({ t: 'var', key: normalizeKey(m[1]) });
    last = at + m[0].length;
  }
  if (last < line.length) parts.push({ t: 'text', s: line.slice(last) });

  const markers = parts.reduce((n, p) => (p.t === 'text' ? n + p.s.split('**').length - 1 : n), 0);
  let toggles = markers - (markers % 2);
  let bold = false;
  const out: RawInline[] = [];
  const pushText = (text: string) => {
    if (text === '') return;
    const prev = out[out.length - 1];
    if (prev && prev.kind === 'text' && prev.bold === bold) prev.text += text;
    else out.push({ kind: 'text', text, bold });
  };
  for (const part of parts) {
    if (part.t === 'var') {
      out.push({ kind: 'var', key: part.key, bold });
      continue;
    }
    part.s.split('**').forEach((piece, i) => {
      if (i > 0) {
        if (toggles > 0) {
          bold = !bold;
          toggles -= 1;
        } else {
          pushText('**');
        }
      }
      pushText(piece);
    });
  }
  return out;
}

/** Variables a template body references, without rendering it (editor warnings). */
export function inspectContractTemplate(body: string): { usedKeys: string[]; unknownKeys: string[] } {
  const used = new Set<string>();
  for (const m of body.matchAll(VAR_RE)) used.add(normalizeKey(m[1]));
  const usedKeys = [...used];
  return { usedKeys, unknownKeys: usedKeys.filter((k) => !getContractVariable(k)) };
}

export function renderContractTemplate(template: string | { body: string }, context: RentalContext): ContractRenderResult {
  const body = typeof template === 'string' ? template : template.body;
  const variables = resolveAllVariables(context);
  const used: string[] = [];
  const unknown = new Set<string>();
  const empty = new Set<string>();

  const markUsed = (key: string) => {
    if (!used.includes(key)) used.push(key);
  };

  const resolveInline = (raw: RawInline[]): ContractInline[] =>
    raw.map((r) => {
      if (r.kind === 'text') return r;
      markUsed(r.key);
      const known = getContractVariable(r.key) !== null;
      const value = known ? (variables[r.key] ?? null) : null;
      if (!known) unknown.add(r.key);
      else if (value === null) empty.add(r.key);
      return { kind: 'variable', key: r.key, value, known, bold: r.bold };
    });

  const inlineHtml = (content: ContractInline[]): string =>
    content
      .map((c) => {
        let html: string;
        if (c.kind === 'text') html = escapeHtml(c.text);
        else if (!c.known) html = escapeHtml(`[missing: ${c.key}]`);
        else {
          const inline = getContractVariable(c.key)?.resolveInlineHtml;
          if (inline) html = inline(context);
          else if (c.value === null) html = '—';
          else html = escapeHtml(c.value).replace(/\n/g, '<br>');
        }
        return c.bold ? `<strong>${html}</strong>` : html;
      })
      .join('');

  const blocks: ContractBlock[] = [];
  const html: string[] = [];
  for (const raw of parseStructure(body)) {
    switch (raw.type) {
      case 'heading': {
        const content = resolveInline(tokenizeLine(raw.line));
        blocks.push({ type: 'heading', level: raw.level, content });
        html.push(`<h${raw.level}>${inlineHtml(content)}</h${raw.level}>`);
        break;
      }
      case 'paragraph': {
        const alone = raw.lines.length === 1 ? ALONE_VAR_RE.exec(raw.lines[0]) : null;
        const blockVar = alone ? getContractVariable(normalizeKey(alone[1])) : null;
        if (blockVar?.resolveBlockHtml) {
          markUsed(blockVar.key);
          blocks.push({ type: 'variable', key: blockVar.key });
          html.push(blockVar.resolveBlockHtml(context));
          break;
        }
        const lines = raw.lines.map((l) => resolveInline(tokenizeLine(l)));
        blocks.push({ type: 'paragraph', lines });
        html.push(`<p>${lines.map(inlineHtml).join('<br>')}</p>`);
        break;
      }
      case 'list': {
        const items = raw.items.map((l) => resolveInline(tokenizeLine(l)));
        const tag = raw.ordered ? 'ol' : 'ul';
        blocks.push({ type: 'list', ordered: raw.ordered, items });
        html.push(`<${tag}>${items.map((i) => `<li>${inlineHtml(i)}</li>`).join('')}</${tag}>`);
        break;
      }
    }
  }

  return {
    html: html.join('\n'),
    blocks,
    variables,
    usedKeys: used,
    unknownKeys: [...unknown],
    emptyKeys: [...empty],
  };
}

const REF_RE = /\b(?:src|href|xlink:href)\s*=\s*["']([^"']*)["']/gi;
const PHOTO_REF_RE = /^carcheck-photo:([A-Za-z0-9_-]+)$/;

/**
 * Checks that frozen contract HTML references nothing but carcheck-photo:<id> and
 * carcheck-signature:customer, and returns the referenced photo ids.
 */
export function contractHtmlReferences(html: string): { photoIds: string[]; signature: boolean; invalid: string[] } {
  const photoIds = new Set<string>();
  const invalid: string[] = [];
  let signature = false;
  for (const m of html.matchAll(REF_RE)) {
    const value = m[1];
    const photo = PHOTO_REF_RE.exec(value);
    if (photo) photoIds.add(photo[1]);
    else if (value === 'carcheck-signature:customer') signature = true;
    else invalid.push(value);
  }
  if (/url\s*\(/i.test(html)) invalid.push('css url()');
  return { photoIds: [...photoIds], signature, invalid };
}
