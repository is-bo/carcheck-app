/**
 * Signed-contract documents. The frozen `renderedHtml` is never re-rendered: the only change
 * made to it is swapping `carcheck-photo:<id>` / `carcheck-signature:customer` attribute values
 * for data URIs, so what the customer signed is byte-for-byte what is printed.
 */
import { formatDateTime, formatTimestampWithZone, shortHash } from './format';
import { htmlDocument, keyValueTable, signatureBlock } from './html/blocks';
import { escapeHtml, escapeMultiline, safeImageSrc } from './html/escape';
import { fontFaceCss } from './html/fonts';
import { printStylesheet } from './html/styles';
import type { ContractAssets, ContractDocInput, DataUri, DocumentOptions, FrozenContract, ResolvedContract } from './types';

export const SIGNATURE_TOKEN = 'carcheck-signature:customer';
export const PHOTO_TOKEN_PREFIX = 'carcheck-photo:';

export type ContractRef =
  | { kind: 'photo'; token: string; photoId: string }
  | { kind: 'signature'; token: typeof SIGNATURE_TOKEN };

/** Resolves one reference to a data URI; null (or a throw) prints a visible "unavailable" placeholder. */
export type ContractRefResolver = (ref: ContractRef) => Promise<DataUri | null> | DataUri | null;

// Attribute values only: a token typed as contract *text* is left alone.
const REF_ATTR = /(\s(?:src|href|xlink:href)\s*=\s*)(["'])(carcheck-(?:photo:[^"'\s<>]+|signature:customer))\2/g;

function toRef(token: string): ContractRef {
  return token === SIGNATURE_TOKEN
    ? { kind: 'signature', token: SIGNATURE_TOKEN }
    : { kind: 'photo', token, photoId: token.slice(PHOTO_TOKEN_PREFIX.length) };
}

/** Unique references in document order. */
export function listContractRefs(html: string): ContractRef[] {
  const seen = new Set<string>();
  const refs: ContractRef[] = [];
  for (const m of html.matchAll(REF_ATTR)) {
    if (!seen.has(m[3])) {
      seen.add(m[3]);
      refs.push(toRef(m[3]));
    }
  }
  return refs;
}

export function hasSignatureRef(html: string): boolean {
  return listContractRefs(html).some((r) => r.kind === 'signature');
}

function placeholder(label: string): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">' +
    '<rect width="400" height="300" fill="#F1F2F2" stroke="#8A9196" stroke-width="2" stroke-dasharray="8 6"/>' +
    `<text x="200" y="156" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#454B50">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const MISSING_PHOTO = placeholder('Photo unavailable');
const MISSING_SIGNATURE = placeholder('Signature unavailable');

/** Replaces each reference attribute with its data URI; everything else is left untouched. */
export function applyContractAssets(html: string, assets: ContractAssets): string {
  return html.replace(REF_ATTR, (_all, pre: string, quote: string, token: string) => {
    const uri = safeImageSrc(assets[token]) ?? (token === SIGNATURE_TOKEN ? MISSING_SIGNATURE : MISSING_PHOTO);
    return `${pre}${quote}${escapeHtml(uri)}${quote}`;
  });
}

/** Resolves references one at a time so only one image is being prepared at any moment. */
export async function resolveContract(
  contract: FrozenContract,
  resolver: ContractRefResolver,
  opts: { signatureOnly?: boolean } = {},
): Promise<ResolvedContract> {
  const refs = opts.signatureOnly
    ? [toRef(SIGNATURE_TOKEN)]
    : [...listContractRefs(contract.renderedHtml), toRef(SIGNATURE_TOKEN)];
  const assets: ContractAssets = {};
  for (const ref of refs) {
    if (ref.token in assets) continue;
    try {
      assets[ref.token] = safeImageSrc(await resolver(ref));
    } catch {
      assets[ref.token] = null;
    }
  }
  return { contract, assets };
}

/**
 * A frozen contract may be a fragment or a whole document. For a whole document the <style>
 * elements and the <body> content are kept verbatim; nothing else is dropped or rewritten.
 */
export function splitFrozenHtml(html: string): { styles: string; body: string } {
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html);
  if (!bodyMatch) return { styles: '', body: html };
  const head = html.slice(0, bodyMatch.index);
  const styles = head.match(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi) ?? [];
  return { styles: styles.join(''), body: bodyMatch[1] };
}

/** Void notice for a contract that was replaced; the text stays legible under the mark. */
function voidNotice(contract: FrozenContract, fixedMark: boolean): string {
  if (!contract.void) return '';
  const when = formatDateTime(contract.void.voidedAt, contract.tzOffsetMin);
  const reason = contract.void.reason ? ` <span class="muted">Reason: ${escapeMultiline(contract.void.reason)}</span>` : '';
  return [
    `<div class="void-mark${fixedMark ? ' fixed' : ''}" aria-hidden="true">VOID</div>`,
    `<div class="void-banner">Voided on ${escapeHtml(when)}. This contract is kept on record and is no longer valid.${reason}</div>`,
  ].join('');
}

/** Who signed, when, and the content fingerprint that "Verify contract" recomputes. */
export function integrityRecord(contract: FrozenContract, reference: string): string {
  return [
    '<section class="integrity">',
    '<h3>Signature record</h3>',
    keyValueTable([
      ['Rental reference', reference],
      ['Signed by', contract.signerName],
      ['Signed at', formatTimestampWithZone(contract.signedAt, contract.tzOffsetMin)],
      [
        'Contract',
        `No. ${contract.sequence}${contract.sequence > 1 ? ' (re-signed)' : ''} · template version ${contract.templateVersion}`,
      ],
      [
        'Content fingerprint',
        { html: `<span class="hash">${escapeHtml(shortHash(contract.contentSha256))}</span> <span class="muted">(SHA-256, first 16 of 64)</span>` },
      ],
      ['Contract ID', contract.id],
    ]),
    '<p class="small muted">The agreement above is reproduced exactly as the customer reviewed it before signing. ',
    'The fingerprint covers its text, the signature and the time of signing.</p>',
    '</section>',
  ].join('');
}

/** The signed contract as a document section: frozen content, signature, integrity record. */
export function contractSection(
  resolved: ResolvedContract,
  opts: { reference: string; fixedVoidMark?: boolean },
): string {
  const { contract, assets } = resolved;
  const { styles, body } = splitFrozenHtml(contract.renderedHtml);
  const signatureInline = hasSignatureRef(body);
  return [
    '<div class="contract-wrap">',
    voidNotice(contract, opts.fixedVoidMark ?? false),
    styles,
    `<div class="contract">${applyContractAssets(body, assets)}</div>`,
    signatureInline
      ? ''
      : signatureBlock({
          image: assets[SIGNATURE_TOKEN] ?? null,
          name: contract.signerName,
          signedAt: contract.signedAt,
          tzOffsetMin: contract.tzOffsetMin,
        }),
    integrityRecord(contract, opts.reference),
    '</div>',
  ].join('');
}

/** Standalone signed-contract PDF HTML. Pass the result to renderPdf(). */
export async function buildContractPdfHtml(
  input: ContractDocInput,
  resolver: ContractRefResolver,
  options: DocumentOptions = {},
): Promise<string> {
  const resolved = await resolveContract(input, resolver);
  return renderContractDocument(input, resolved.assets, options);
}

/** Synchronous variant for callers that already hold the resolved assets. */
export function renderContractDocument(
  input: ContractDocInput,
  assets: ContractAssets,
  options: DocumentOptions = {},
): string {
  const title = input.void ? 'Signed contract (voided)' : 'Signed contract';
  const css = printStylesheet(
    {
      headerLeft: input.agencyName,
      headerRight: `${input.reference} · ${title}`,
      footerLeft: `Signed ${formatDateTime(input.signedAt, input.tzOffsetMin)} by ${input.signerName}`,
    },
    options.embedFonts === false ? '' : fontFaceCss(),
  );
  const body = contractSection({ contract: input, assets }, { reference: input.reference, fixedVoidMark: true });
  return htmlDocument({ title: `${title} ${input.reference}`, css, body });
}
