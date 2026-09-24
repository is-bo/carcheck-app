import { SIGNATURE_TOKEN } from '../contract';
import { buildDamageReportHtml, buildEvidencePackHtml, evidenceImageWidthMm, pickAppendixContract } from '../report';
import type { DocEvidenceImage, DocPhotoThumb, ResolvedContract } from '../types';
import { agency, contract, damage, JPEG, PNG, rental, reportInput, T0 } from './fixtures';

const noFonts = { embedFonts: false };

const existing = damage({ id: 'd-a', status: 'pre_existing', number: 1, type: 'scratch', angleKey: 'left', angleLabel: 'Left' });
const new1 = damage({ id: 'd-1', status: 'new', number: 1, locationLabel: 'front bumper', severity: 'moderate', note: 'Fresh <paint>' });
const unc2 = damage({ id: 'd-2', status: 'uncertain', number: 2, type: 'chip', closeup: JPEG });

const evidence: DocEvidenceImage = {
  angleKey: 'front_left',
  slot: 1,
  angleLabel: 'Front left',
  image: JPEG,
  width: 1592,
  height: 2800,
  damageIds: ['d-2', 'd-1', 'missing'],
};

const thumbs: DocPhotoThumb[] = [
  { angleKey: 'front', slot: 1, angleLabel: 'Front', image: JPEG, capturedAt: T0, tzOffsetMin: 120, skipReason: null },
  { angleKey: 'rear', slot: 1, angleLabel: 'Rear', image: null, capturedAt: null, tzOffsetMin: null, skipReason: 'blocked' },
];

const pickup: DocPhotoThumb[] = [
  { angleKey: 'front', slot: 1, angleLabel: 'Front', image: JPEG, capturedAt: T0 - 86_400_000, tzOffsetMin: 120, skipReason: null },
  { angleKey: 'rear', slot: 1, angleLabel: 'Rear', image: JPEG, capturedAt: T0 - 86_400_000, tzOffsetMin: 120, skipReason: null },
];

const signed: ResolvedContract = {
  contract: contract(),
  assets: { 'carcheck-photo:p-1': JPEG, 'carcheck-photo:p-2': JPEG, [SIGNATURE_TOKEN]: PNG },
};
const voided: ResolvedContract = {
  contract: contract({ id: 'c-0', sequence: 1, void: { contractId: 'c-0', voidedAt: T0 + 60_000, reason: null, createdAt: 0 } }),
  assets: { [SIGNATURE_TOKEN]: PNG },
};
const resigned: ResolvedContract = { ...signed, contract: contract({ id: 'c-2', sequence: 2 }) };

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('buildDamageReportHtml: damage variant', () => {
  const html = buildDamageReportHtml(
    reportInput({
      damages: [existing, unc2, new1],
      evidence: [evidence],
      returnPhotos: thumbs,
      pickupPhotos: pickup,
      contracts: [voided, resigned],
    }),
    noFonts,
  );

  it('prints the cover with rental facts', () => {
    expect(html).toContain('<title>Return report R-0142</title>');
    expect(html).toContain('Coastline &lt;Rentals&gt; &amp; Co');
    expect(html).toContain('<span class="plate lg">AB-123-CD</span>');
    expect(html).toContain('1 new damage · 1 uncertain found at return.');
    expect(html).toContain('24 Sep 2026, 17:05');
    expect(html).toContain('12 000 km');
    expect(html).toContain('345 km');
    expect(html).toContain('Full');
    expect(html).toContain('½');
  });

  it('escapes user text everywhere', () => {
    expect(html).toContain('Jane &quot;JJ&quot; Smith');
    expect(html).toContain('“Fresh &lt;paint&gt;”');
    expect(html).not.toContain('<paint>');
    expect(html).not.toContain('<Rentals>');
  });

  it('puts each damaged angle on its own page with the composed image and ordered captions', () => {
    expect(count(html, '<section class="evidence page-break">')).toBe(1);
    expect(html).toContain('Evidence 1 of 1');
    expect(html).toContain(`class="evidence-img" style="width:82.4mm"`);
    const captions = html.slice(html.indexOf('<ul class="captions">'));
    expect(captions.indexOf('New 1 · Dent, front bumper')).toBeLessThan(captions.indexOf('Uncertain 2? · Chip'));
    expect(captions).toContain(' — Moderate');
    expect(html).toContain('Uncertain 2? · close-up');
  });

  it('lists all damage in the damage table in evidence order', () => {
    const table = html.slice(html.indexOf('<table class="grid">'), html.indexOf('</table>', html.indexOf('<table class="grid">')));
    expect(table.indexOf('New 1')).toBeLessThan(table.indexOf('Uncertain 2?'));
    expect(table.indexOf('Uncertain 2?')).toBeLessThan(table.indexOf('Existing A'));
    expect(table).toContain('Pick-up');
  });

  it('adds the pick-up | return contact sheet, then the valid contract as appendix and every signature', () => {
    expect(html).toContain('All angles, pick-up and return');
    expect(html).toContain('Skipped · Blocked');
    expect(html).toContain('Front · After · 24.09.2026 17:05');
    // BEFORE then AFTER for each angle.
    const sheet = html.slice(html.indexOf('<div class="sheet">'));
    expect(sheet.indexOf('Front · Before')).toBeLessThan(sheet.indexOf('Front · After'));
    expect(sheet.indexOf('Front · After')).toBeLessThan(sheet.indexOf('Rear · Before'));
    const appendix = html.slice(html.indexOf('<h1>Signed contract</h1>'));
    expect(appendix).toContain('<h1>Rental agreement</h1>');
    expect(appendix).toContain('No. 2 (re-signed)');
    expect(appendix).not.toContain('class="void-mark');
    expect(html).toContain('Contract 1 · voided 24 Sep 2026');
    expect(html).toContain('Contract 2 · valid');
    expect(html).toContain('1 earlier contract was voided');
    expect(html).toContain('Thank you for renting with us.');
  });

  it('keeps the page structure rules', () => {
    expect(html).toContain('@page{size:A4;margin:16mm 16mm 18mm 16mm;');
    expect(html).toContain('content:"Coastline <Rentals> & Co"'.replace('<', '\\3C '));
    expect(html).toContain('content:"R-0142 · Return report"');
    expect(html).toContain('Generated 27 Sep 2026, 17:05');
    expect(html).toContain('.page-break{break-before:page;page-break-before:always;}');
  });
});

describe('buildDamageReportHtml: clean return', () => {
  const html = buildDamageReportHtml(
    reportInput({ damages: [existing], returnPhotos: thumbs, contracts: [signed] }),
    noFonts,
  );

  it('states the clean result and shows the AFTER contact sheet instead of evidence', () => {
    expect(html).toContain('No new damage found. Returned in the same condition as at pick-up.');
    expect(html).not.toContain('class="evidence');
    expect(html).toContain('Condition at pick-up and return');
    // Two angles, each with an empty BEFORE partner (no pick-up thumbs in this input) and its AFTER.
    expect(count(html, '<div class="tile">')).toBe(4);
    expect(html).toContain('Existing A');
    expect(html).not.toContain('<h2>Signatures</h2>');
  });

  it('marks a revised report', () => {
    const revised = buildDamageReportHtml(reportInput({ rental: { ...rental, returnRevision: 2 } }), noFonts);
    expect(revised).toContain('Return report (revised)');
    expect(revised).toContain('Revision 2');
    expect(revised).toContain('No damage recorded at pick-up or return.');
    expect(revised).not.toContain('Signed contract');
  });
});

describe('helpers', () => {
  it('sizes evidence images to fit the page', () => {
    expect(evidenceImageWidthMm({ width: 2800, height: 2512 }, 1)).toBe(178);
    expect(evidenceImageWidthMm({ width: 1592, height: 2800 }, 1)).toBe(110.9);
    expect(evidenceImageWidthMm({ width: 1592, height: 2800 }, 8)).toBe(93.8);
    expect(evidenceImageWidthMm({ width: 1592, height: 2800 }, 1, true)).toBe(82.4);
  });

  it('embeds the newest valid contract, else the newest voided one', () => {
    expect(pickAppendixContract([voided, resigned])?.contract.id).toBe('c-2');
    expect(pickAppendixContract([voided])?.contract.id).toBe('c-0');
    expect(pickAppendixContract([])).toBeNull();
  });
});

describe('buildEvidencePackHtml', () => {
  it('prints one evidence image per page', () => {
    const html = buildEvidencePackHtml(
      {
        agency,
        rental,
        damages: [new1, unc2],
        evidence: [evidence, { ...evidence, angleKey: 'rear', angleLabel: 'Rear', damageIds: ['d-1'] }],
        generatedAt: T0,
        tzOffsetMin: 120,
      },
      noFonts,
    );
    expect(count(html, '<section class="evidence">')).toBe(1);
    expect(count(html, '<section class="evidence page-break">')).toBe(1);
    expect(html).toContain('Evidence 2 of 2');
    expect(html).toContain('Renault Clio · 2021 · White · Jane &quot;JJ&quot; Smith');
  });
});
