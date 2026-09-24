/**
 * The "existing damage" block of a contract: each pick-up photo with its lettered markers
 * inlined as SVG, followed by the captions. The markers are drawn from the snapshot at render
 * time, so later edits can never alter a signed contract. The only external reference is
 * `carcheck-photo:<photoId>`, resolved when the contract is displayed or printed.
 *
 * Output stays inside the subset src/documents parses for native display and printing:
 * p, ul/li, strong, img, and svg with an <image> of the photo.
 */
import { DAMAGE_SEVERITY_LABELS, damageTypeLabel } from '../damage';
import type { ContractDamageItem } from './context';
import { escapeHtml, joinText } from './format';

export const PHOTO_URI_PREFIX = 'carcheck-photo:';
export const SIGNATURE_URI = 'carcheck-signature:customer';

const INK = '#131517';
const HALO = '#FFFFFF';

/** "A — Scratch, front bumper · Minor · “note”" */
export function damageItemText(d: ContractDamageItem): string {
  const what = joinText([damageTypeLabel(d.type), d.locationLabel ?? d.angleLabel], ', ') ?? '';
  const parts = [what, d.severity ? DAMAGE_SEVERITY_LABELS[d.severity] : null, d.note ? `“${d.note}”` : null];
  return `${d.label} — ${joinText(parts, ' · ')}`;
}

/** Inline form: "A — Scratch, front bumper · Minor; B — Dent, rear door". */
export function damageSummaryText(items: readonly ContractDamageItem[]): string {
  if (items.length === 0) return 'No existing damage recorded';
  return items.map(damageItemText).join('; ');
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** Solid ring + hollow square letter badge (pre-existing), never over the ring centre. */
function markerSvg(item: ContractDamageItem): string {
  const w = item.photoWidth;
  const h = item.photoHeight;
  const short = Math.min(w, h);
  const cx = item.ring.x * w;
  const cy = item.ring.y * h;
  const r = Math.max(item.ring.r, 0.015) * short;
  const stroke = short * 0.008;
  const size = short * 0.07;
  const offset = (r + size * 0.2) * Math.SQRT1_2;
  let bx = cx + offset;
  let by = cy - offset - size;
  if (bx + size > w) bx = cx - offset - size;
  if (by < 0) by = cy + offset;
  bx = Math.min(Math.max(bx, 0), w - size);
  by = Math.min(Math.max(by, 0), h - size);
  return (
    `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="none" stroke="${HALO}" stroke-width="${fmt(stroke * 2.6)}"/>` +
    `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="none" stroke="${INK}" stroke-width="${fmt(stroke)}"/>` +
    `<rect x="${fmt(bx)}" y="${fmt(by)}" width="${fmt(size)}" height="${fmt(size)}" fill="${HALO}" stroke="${INK}" stroke-width="${fmt(stroke)}"/>` +
    `<text x="${fmt(bx + size / 2)}" y="${fmt(by + size * 0.72)}" text-anchor="middle" font-family="sans-serif"` +
    ` font-weight="700" font-size="${fmt(size * 0.62)}" fill="${INK}">${escapeHtml(item.label)}</text>`
  );
}

/** Block HTML for {{damage.existing_list}}. */
export function damageListHtml(items: readonly ContractDamageItem[]): string {
  if (items.length === 0) return '<p>No existing damage was recorded at pick-up.</p>';
  const byPhoto = new Map<string, ContractDamageItem[]>();
  for (const item of items) {
    const list = byPhoto.get(item.photoId);
    if (list) list.push(item);
    else byPhoto.set(item.photoId, [item]);
  }
  const figures = [...byPhoto.values()].map((group) => {
    const first = group[0];
    const w = first.photoWidth;
    const h = first.photoHeight;
    const href = escapeHtml(PHOTO_URI_PREFIX + first.photoId);
    const label = escapeHtml(first.angleLabel);
    const letters = group.map((g) => escapeHtml(g.label)).join(', ');
    return (
      '<p style="break-inside:avoid;page-break-inside:avoid">' +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}"` +
      ' style="display:block;width:100%;max-width:560px;height:auto">' +
      `<image href="${href}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"/>` +
      group.map(markerSvg).join('') +
      '</svg></p>' +
      `<p><strong>${label}</strong> · ${letters}</p>`
    );
  });
  const captions = items.map((d) => `<li>${escapeHtml(damageItemText(d))}</li>`).join('');
  return `${figures.join('')}<ul style="list-style:none;padding-left:0">${captions}</ul>`;
}

/** Block HTML for {{signature.customer}}; the viewer resolves the URI (or shows the pad line). */
export function signatureHtml(alt: string): string {
  return `<p><img src="${SIGNATURE_URI}" alt="${escapeHtml(alt)}" style="height:22mm"></p>`;
}

export function signatureInlineHtml(alt: string): string {
  return `<img src="${SIGNATURE_URI}" alt="${escapeHtml(alt)}" style="height:14mm;vertical-align:middle">`;
}
