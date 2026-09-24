/**
 * Shared HTML blocks for printed documents. Every function returns an HTML string and escapes
 * all user text itself; callers never pass pre-escaped values except where a parameter says html.
 */
import type { DamageStatus, EpochMs } from '@/domain/types';
import { palette } from '@/ui/theme/tokens';

import {
  damageDescription,
  damageTitle,
  formatEdgeCodeTime,
  formatTimestampWithZone,
  joinNonEmpty,
  severityLabel,
  skipReasonLabel,
} from '../format';
import type { DataUri, DocAgency, DocDamage, DocPhotoThumb } from '../types';
import { escapeHtml, escapeMultiline, safeImageSrc } from './escape';

export function htmlDocument(p: { title: string; css: string; body: string }): string {
  return [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(p.title)}</title><style>`,
    p.css,
    '</style></head><body>',
    p.body,
    '</body></html>',
  ].join('');
}

export function img(src: DataUri | null, attrs: { alt: string; className?: string; style?: string }): string {
  const safe = safeImageSrc(src);
  if (!safe) return '';
  const cls = attrs.className ? ` class="${escapeHtml(attrs.className)}"` : '';
  const style = attrs.style ? ` style="${escapeHtml(attrs.style)}"` : '';
  return `<img${cls}${style} alt="${escapeHtml(attrs.alt)}" src="${escapeHtml(safe)}">`;
}

export function plate(text: string, large = false): string {
  return `<span class="plate${large ? ' lg' : ''}">${escapeHtml(text)}</span>`;
}

/** Agency identity on the left, document title and rental reference on the right. */
export function masthead(agency: DocAgency, doc: { title: string; reference: string | null }): string {
  const contact = joinNonEmpty([agency.address, agency.phone, agency.email]);
  const reg = agency.registrationNumber ? `Reg. ${agency.registrationNumber}` : null;
  return [
    '<header class="masthead"><div class="masthead-agency">',
    // The name is printed beside the logo, so the image is decorative.
    img(agency.logo, { alt: '', className: 'masthead-logo' }),
    '<div>',
    `<div class="masthead-name">${escapeHtml(agency.name)}</div>`,
    contact ? `<div class="masthead-contact">${escapeHtml(contact)}</div>` : '',
    reg ? `<div class="masthead-contact">${escapeHtml(reg)}</div>` : '',
    '</div></div><div class="masthead-doc">',
    `<div class="title">${escapeHtml(doc.title)}</div>`,
    doc.reference ? `<div class="ref">${escapeHtml(doc.reference)}</div>` : '',
    '</div></header>',
  ].join('');
}

export function sectionTitle(title: string, aside?: string, level: 'h2' | 'h3' = 'h2'): string {
  const right = aside ? `<span class="aside">${escapeHtml(aside)}</span>` : '';
  return `<div class="section-title"><${level}>${escapeHtml(title)}</${level}>${right}</div>`;
}

/** A row of a key-value table. `html` values are trusted markup built by these helpers. */
export type KvRow = [label: string, value: string | null | undefined] | [label: string, html: { html: string }];

export function keyValueTable(rows: KvRow[]): string {
  const body = rows
    .map(([label, value]) => {
      if (value === null || value === undefined) return '';
      const cell = typeof value === 'string' ? (value.trim() ? escapeMultiline(value) : '') : value.html;
      if (!cell) return '';
      return `<tr><th scope="row">${escapeHtml(label)}</th><td>${cell}</td></tr>`;
    })
    .join('');
  return body ? `<table class="kv"><tbody>${body}</tbody></table>` : '';
}

/** Marker shapes as in the app: circle = new, diamond = uncertain, hollow square = existing. */
export function statusGlyph(status: DamageStatus): string {
  const open = '<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">';
  switch (status) {
    case 'new':
      return `${open}<circle cx="12" cy="12" r="10" fill="${palette.vermilion}"/></svg>`;
    case 'uncertain':
      return `${open}<polygon points="12,1.5 22.5,12 12,22.5 1.5,12" fill="${palette.amber}" stroke="${palette.ink}" stroke-width="1.6"/></svg>`;
    case 'pre_existing':
      return `${open}<rect x="3" y="3" width="18" height="18" fill="#fff" stroke="${palette.ink}" stroke-width="2.4"/></svg>`;
  }
}

const STATUS_ORDER: Record<DamageStatus, number> = { new: 0, uncertain: 1, pre_existing: 2 };

/** Evidence order: new, uncertain, existing; then by number. */
export function sortDamages<T extends Pick<DocDamage, 'status' | 'number'>>(damages: T[]): T[] {
  return [...damages].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.number - b.number);
}

export function damageCountsLine(damages: Pick<DocDamage, 'status'>[]): string {
  const count = (s: DamageStatus) => damages.filter((d) => d.status === s).length;
  const item = (s: DamageStatus, n: number, word: string) =>
    `<span>${statusGlyph(s)}<strong class="num">${n}</strong> ${escapeHtml(word)}</span>`;
  return [
    '<div class="status-line">',
    item('new', count('new'), 'new'),
    item('uncertain', count('uncertain'), 'uncertain'),
    item('pre_existing', count('pre_existing'), 'existing at pick-up'),
    '</div>',
  ].join('');
}

/** All damages as a table: mark, angle, description, severity, note. */
export function damageTable(damages: DocDamage[]): string {
  if (damages.length === 0) return '';
  const rows = sortDamages(damages)
    .map((d) => {
      const found = d.foundPhase === 'before' ? 'Pick-up' : 'Return';
      return [
        '<tr>',
        `<td class="mark">${statusGlyph(d.status)}${escapeHtml(damageTitle(d.status, d.number))}</td>`,
        `<td>${escapeHtml(d.angleLabel)}</td>`,
        `<td>${escapeHtml(damageDescription(d.type, d.locationLabel))}`,
        d.note ? `<div class="note">“${escapeMultiline(d.note)}”</div>` : '',
        '</td>',
        `<td>${escapeHtml(severityLabel(d.severity) ?? '—')}</td>`,
        `<td>${found}</td>`,
        '</tr>',
      ].join('');
    })
    .join('');
  return [
    '<table class="grid"><thead><tr>',
    '<th>Mark</th><th>Angle</th><th>Damage</th><th>Severity</th><th>Found at</th>',
    `</tr></thead><tbody>${rows}</tbody></table>`,
  ].join('');
}

/** Caption rows under an evidence image, the same wording as the image footer. */
export function captionList(damages: DocDamage[]): string {
  if (damages.length === 0) return '';
  const items = sortDamages(damages)
    .map((d) => {
      const severity = severityLabel(d.severity);
      return [
        '<li>',
        statusGlyph(d.status),
        `<strong>${escapeHtml(damageTitle(d.status, d.number))} · ${escapeHtml(damageDescription(d.type, d.locationLabel))}</strong>`,
        severity ? `<span class="detail"> — ${escapeHtml(severity)}</span>` : '',
        d.note ? `<span class="note">“${escapeMultiline(d.note)}”</span>` : '',
        '</li>',
      ].join('');
    })
    .join('');
  return `<ul class="captions">${items}</ul>`;
}

/** Close-up photos of the given damages, three per row. */
export function closeupFigures(damages: DocDamage[]): string {
  const figures = sortDamages(damages)
    .filter((d) => safeImageSrc(d.closeup))
    .map((d) => {
      const title = `${damageTitle(d.status, d.number)} · close-up`;
      return `<figure class="keep">${img(d.closeup, { alt: title })}<span class="code">${escapeHtml(title)}</span></figure>`;
    });
  return figures.length ? `<div class="closeups">${figures.join('')}</div>` : '';
}

/** Compact 4-up contact sheet with edge-code captions ("FRONT LEFT · AFTER · 24.09.2026 17:05"). */
function sheetTile(t: DocPhotoThumb, phaseWord: string): string {
  const photo = img(t.image, { alt: `${t.angleLabel} ${phaseWord}` });
  const inner = photo
    ? photo
    : `<div class="skip">${escapeHtml(t.skipReason ? `Skipped · ${skipReasonLabel(t.skipReason)}` : 'No photo')}</div>`;
  const time = t.capturedAt !== null && t.tzOffsetMin !== null ? formatEdgeCodeTime(t.capturedAt, t.tzOffsetMin) : null;
  const code = joinNonEmpty([t.angleLabel, phaseWord, time]);
  return `<div class="tile"><div class="tile-frame">${inner}</div><span class="code">${escapeHtml(code)}</span></div>`;
}

export function contactSheet(thumbs: DocPhotoThumb[], phaseWord: string): string {
  if (thumbs.length === 0) return '';
  return `<div class="sheet">${thumbs.map((t) => sheetTile(t, phaseWord)).join('')}</div>`;
}

/**
 * Pick-up and return condition side by side: BEFORE | AFTER per angle, two angles per row of
 * the four-column sheet. Angles present in only one phase keep an empty "No photo" partner.
 */
export function pairedContactSheet(before: DocPhotoThumb[], after: DocPhotoThumb[]): string {
  const key = (t: DocPhotoThumb) => `${t.angleKey}#${t.slot}`;
  const afterByKey = new Map(after.map((t) => [key(t), t]));
  const keys = [...before.map(key), ...after.map(key).filter((k) => !before.some((b) => key(b) === k))];
  const beforeByKey = new Map(before.map((t) => [key(t), t]));
  const empty = (t: DocPhotoThumb): DocPhotoThumb => ({ ...t, image: null, capturedAt: null, tzOffsetMin: null, skipReason: null });
  const tiles = keys.map((k) => {
    const b = beforeByKey.get(k);
    const a = afterByKey.get(k);
    return sheetTile(b ?? empty(a!), 'Before') + sheetTile(a ?? empty(b!), 'After');
  });
  return tiles.length ? `<div class="sheet">${tiles.join('')}</div>` : '';
}

export interface SignatureBlockInput {
  image: DataUri | null;
  name: string;
  signedAt: EpochMs;
  tzOffsetMin: number;
  /** Optional state line, e.g. "Voided 25 Sep 2026". */
  state?: string;
}

/** Signature on its baseline, signer name and the timestamp with its UTC offset. */
export function signatureBlock(s: SignatureBlockInput): string {
  const picture = img(s.image, { alt: `Signature of ${s.name}` }) || '<div class="missing">Signature image unavailable</div>';
  return [
    '<div class="signature">',
    picture,
    '<div class="line"></div>',
    `<div class="name">${escapeHtml(s.name)}</div>`,
    `<div class="when num">Signed ${escapeHtml(formatTimestampWithZone(s.signedAt, s.tzOffsetMin))}</div>`,
    s.state ? `<div class="state">${escapeHtml(s.state)}</div>` : '',
    '</div>',
  ].join('');
}

export function footerNote(text: string | null): string {
  return text && text.trim() ? `<p class="footer-note">${escapeMultiline(text.trim())}</p>` : '';
}
