/**
 * Final damage report and the evidence-pack fallback. Pure: all images arrive as data URIs.
 *
 * Report order: cover (agency, rental, customer, vehicle, dates, mileage, fuel) → summary and
 * damage list → one page per damaged angle with its composed evidence image → condition at
 * return (contact sheet) → appendix with the signed contract and every signature.
 */
import { contractSection, SIGNATURE_TOKEN } from './contract';
import {
  formatDate,
  formatDateTime,
  formatFuel,
  formatInteger,
  formatMileage,
  joinNonEmpty,
} from './format';
import {
  captionList,
  closeupFigures,
  contactSheet,
  damageCountsLine,
  damageTable,
  footerNote,
  htmlDocument,
  img,
  keyValueTable,
  masthead,
  plate,
  sectionTitle,
  signatureBlock,
} from './html/blocks';
import { escapeHtml } from './html/escape';
import { fontFaceCss } from './html/fonts';
import { CONTENT_WIDTH_MM, printStylesheet } from './html/styles';
import type {
  DamageReportInput,
  DocDamage,
  DocEvidenceImage,
  DocRental,
  DocumentOptions,
  EvidencePackInput,
  ResolvedContract,
} from './types';

export const REPORT_TITLE = 'Return report';
export const EVIDENCE_PACK_TITLE = 'Evidence images';

function vehicleLine(vehicle: DocRental['vehicle']): string {
  if (!vehicle) return '';
  return joinNonEmpty([joinNonEmpty([vehicle.make, vehicle.model], ' '), vehicle.year?.toString(), vehicle.color]);
}

function reportTitle(rental: DocRental): string {
  return rental.returnRevision > 1 ? `${REPORT_TITLE} (revised)` : REPORT_TITLE;
}

/**
 * Printed size of an evidence image: full text width unless its height would overflow the page.
 * Height budgets keep heading, image, captions (and a row of close-ups) on one A4 page.
 */
export function evidenceImageWidthMm(
  e: Pick<DocEvidenceImage, 'width' | 'height'>,
  captionCount: number,
  hasCloseups = false,
): number {
  const maxHeightMm = (captionCount > 6 ? 165 : 195) - (hasCloseups ? 50 : 0);
  if (e.width <= 0 || e.height <= 0) return CONTENT_WIDTH_MM;
  return Math.round(Math.min(CONTENT_WIDTH_MM, (maxHeightMm * e.width) / e.height) * 10) / 10;
}

function evidenceSection(e: DocEvidenceImage, index: number, total: number, damages: DocDamage[], breakBefore: boolean): string {
  const byId = new Map(damages.map((d) => [d.id, d]));
  const shown = e.damageIds.map((id) => byId.get(id)).filter((d): d is DocDamage => d !== undefined);
  const width = evidenceImageWidthMm(e, shown.length, shown.some((d) => d.closeup !== null));
  return [
    `<section class="evidence${breakBefore ? ' page-break' : ''}">`,
    '<div class="keep">',
    sectionTitle(e.angleLabel, `Evidence ${index + 1} of ${total}`),
    img(e.image, { alt: `${e.angleLabel}: before and after`, className: 'evidence-img', style: `width:${width}mm` }),
    captionList(shown),
    '</div>',
    closeupFigures(shown),
    '</section>',
  ].join('');
}

/** The contract embedded in the report: the newest valid one, else the newest voided one. */
export function pickAppendixContract(contracts: ResolvedContract[]): ResolvedContract | null {
  const bySequence = [...contracts].sort((a, b) => b.contract.sequence - a.contract.sequence);
  return bySequence.find((c) => !c.contract.void) ?? bySequence[0] ?? null;
}

/** Every signature side by side; only needed once a contract was voided and re-signed. */
function signaturesSection(contracts: ResolvedContract[]): string {
  if (contracts.length < 2) return '';
  const blocks = [...contracts]
    .sort((a, b) => a.contract.sequence - b.contract.sequence)
    .map(({ contract, assets }) =>
      signatureBlock({
        image: assets[SIGNATURE_TOKEN] ?? null,
        name: contract.signerName,
        signedAt: contract.signedAt,
        tzOffsetMin: contract.tzOffsetMin,
        state: contract.void
          ? `Contract ${contract.sequence} · voided ${formatDate(contract.void.voidedAt, contract.tzOffsetMin)}`
          : `Contract ${contract.sequence} · valid`,
      }),
    )
    .join('');
  return `<section class="section keep">${sectionTitle('Signatures')}<div class="signatures">${blocks}</div></section>`;
}

export function buildDamageReportHtml(input: DamageReportInput, options: DocumentOptions = {}): string {
  const { agency, rental, damages, evidence } = input;
  const tz = input.tzOffsetMin;
  const reference = rental.reference ?? '';
  const title = reportTitle(rental);
  const newCount = damages.filter((d) => d.status === 'new').length;
  const uncertainCount = damages.filter((d) => d.status === 'uncertain').length;
  const clean = newCount === 0 && uncertainCount === 0;
  const unit = rental.distanceUnit;
  const date = (ms: number | null) => (ms === null ? null : formatDateTime(ms, tz));

  const distance =
    rental.startMileage !== null && rental.returnMileage !== null && rental.returnMileage >= rental.startMileage
      ? `${formatInteger(rental.returnMileage - rental.startMileage)} ${unit}`
      : null;

  const statement = clean
    ? 'No new damage found. Returned in the same condition as at pick-up.'
    : joinNonEmpty(
        [
          newCount ? `${newCount} new ${newCount === 1 ? 'damage' : 'damages'}` : null,
          uncertainCount ? `${uncertainCount} uncertain` : null,
        ],
        ' · ',
      ) + ' found at return.';

  const customer = rental.customer;
  const vehicle = rental.vehicle;

  const cover = [
    masthead(agency, { title, reference }),
    '<div class="cover-title">',
    `<h1>${escapeHtml(title)}${vehicle ? ` ${plate(vehicle.plate, true)}` : ''}</h1>`,
    `<div class="cover-sub">${escapeHtml(
      joinNonEmpty([
        vehicleLine(vehicle),
        customer.fullName,
        rental.returnRevision > 1 ? `Revision ${rental.returnRevision}` : null,
      ]),
    )}</div>`,
    `<p class="statement">${escapeHtml(statement)}</p>`,
    damageCountsLine(damages),
    '</div>',
    '<div class="section columns">',
    '<div>',
    sectionTitle('Customer', undefined, 'h3'),
    keyValueTable([
      ['Name', customer.fullName],
      ['Phone', customer.phone],
      ['Address', customer.address],
      ['Licence no.', customer.licenceNumber],
      ['ID / passport no.', customer.idNumber],
    ]),
    '</div><div>',
    sectionTitle('Vehicle', undefined, 'h3'),
    vehicle
      ? keyValueTable([
          ['Plate', { html: plate(vehicle.plate) }],
          ['Make and model', joinNonEmpty([vehicle.make, vehicle.model], ' ')],
          ['Year', vehicle.year?.toString()],
          ['Colour', vehicle.color],
          ['VIN', vehicle.vin],
        ])
      : '<p class="muted">No vehicle recorded.</p>',
    '</div></div>',
    `<section class="section keep">${sectionTitle('Rental', reference || undefined)}`,
    keyValueTable([
      ['Picked up', date(rental.startedAt)],
      ['Expected return', date(rental.expectedReturnAt)],
      ['Returned', date(rental.returnedAt)],
      ['Mileage out', formatMileage(rental.startMileage, unit)],
      ['Mileage in', formatMileage(rental.returnMileage, unit)],
      ['Distance driven', distance],
      ['Fuel out', formatFuel(rental.startFuelEighths)],
      ['Fuel in', formatFuel(rental.returnFuelEighths)],
      ['Return notes', rental.returnNotes],
    ]),
    '</section>',
  ];

  const damageList =
    damages.length > 0
      ? `<section class="section">${sectionTitle('Damage', `${damages.length} recorded`)}${damageTable(damages)}</section>`
      : `<section class="section">${sectionTitle('Damage')}<p class="muted">No damage recorded at pick-up or return.</p></section>`;

  const sheet = (breakBefore: boolean, heading: string) =>
    input.returnPhotos.length
      ? `<section class="section${breakBefore ? ' page-break' : ''}">${sectionTitle(heading, `${input.returnPhotos.length} angles`)}${contactSheet(input.returnPhotos, 'After')}</section>`
      : '';

  const evidenceBlocks = evidence.map((e, i) => evidenceSection(e, i, evidence.length, damages, true)).join('');

  const appendixContract = pickAppendixContract(input.contracts);
  const appendix = appendixContract
    ? [
        '<section class="page-break">',
        `<div class="section-title"><h1>Signed contract</h1><span class="aside">Appendix</span></div>`,
        contractSection(appendixContract, { reference }),
        '</section>',
      ].join('')
    : '';
  const voidedList = input.contracts.filter((c) => c.contract.void).length;
  const voidedNote = voidedList
    ? `<p class="small muted">${voidedList} earlier ${voidedList === 1 ? 'contract was' : 'contracts were'} voided and re-signed; ${voidedList === 1 ? 'it is' : 'they are'} kept on record and listed below.</p>`
    : '';

  const body = [
    ...cover,
    damageList,
    clean ? sheet(false, 'Condition at return') : evidenceBlocks + sheet(true, 'All angles at return'),
    appendix,
    voidedNote,
    signaturesSection(input.contracts),
    footerNote(agency.reportFooter),
  ].join('');

  const css = printStylesheet(
    {
      headerLeft: agency.name,
      headerRight: joinNonEmpty([reference, title]),
      footerLeft: `Generated ${formatDateTime(input.generatedAt, tz)}`,
    },
    options.embedFonts === false ? '' : fontFaceCss(),
  );
  return htmlDocument({ title: joinNonEmpty([title, reference], ' '), css, body });
}

/** One evidence image per page with its captions; used when multi-file sharing is unavailable. */
export function buildEvidencePackHtml(input: EvidencePackInput, options: DocumentOptions = {}): string {
  const { agency, rental, evidence, damages } = input;
  const reference = rental.reference ?? '';
  const sub = joinNonEmpty([
    vehicleLine(rental.vehicle),
    rental.customer.fullName,
    rental.returnedAt === null ? null : `Returned ${formatDateTime(rental.returnedAt, input.tzOffsetMin)}`,
  ]);
  const body = [
    masthead(agency, { title: EVIDENCE_PACK_TITLE, reference }),
    '<div class="cover-title">',
    `<h1>${escapeHtml(EVIDENCE_PACK_TITLE)}${rental.vehicle ? ` ${plate(rental.vehicle.plate, true)}` : ''}</h1>`,
    sub ? `<div class="cover-sub">${escapeHtml(sub)}</div>` : '',
    '</div>',
    evidence.length
      ? evidence.map((e, i) => evidenceSection(e, i, evidence.length, damages, i > 0)).join('')
      : '<p class="section muted">No evidence images: no new damage was marked.</p>',
    footerNote(agency.reportFooter),
  ].join('');
  const css = printStylesheet(
    {
      headerLeft: agency.name,
      headerRight: joinNonEmpty([reference, EVIDENCE_PACK_TITLE]),
      footerLeft: `Generated ${formatDateTime(input.generatedAt, input.tzOffsetMin)}`,
    },
    options.embedFonts === false ? '' : fontFaceCss(),
  );
  return htmlDocument({ title: joinNonEmpty([EVIDENCE_PACK_TITLE, reference], ' '), css, body });
}
