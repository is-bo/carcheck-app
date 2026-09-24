import { computeEvidenceLayout } from '../../evidenceLayout';
import { deriveCounterpart, type Size } from '../../geometry';
import {
  composeEvidenceFingerprint,
  composeEvidenceInputHash,
  evidenceFootnote,
  toEvidenceDamage,
  toEvidenceLayoutInput,
  type ComposeEvidenceInputs,
  type EvidenceDamageSource,
} from '../evidenceInput';

jest.mock('expo-crypto', () => {
  const { createHash } = jest.requireActual('crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_alg: string, data: string) => createHash('sha256').update(data, 'utf8').digest('hex'),
  };
});

const B: Size = { width: 4032, height: 3024 };
const A: Size = { width: 4032, height: 3024 };

const dent: EvidenceDamageSource = {
  status: 'new',
  number: 1,
  foundPhase: 'after',
  marker: { v: 1, ring: { x: 0.62, y: 0.58, r: 0.05 } },
  typeLabel: 'Scratch',
  locationLabel: 'front bumper',
  severityLabel: 'Moderate',
};
const scuff: EvidenceDamageSource = {
  status: 'pre_existing',
  number: 1,
  foundPhase: 'before',
  marker: { v: 1, ring: { x: 0.2, y: 0.4, r: 0.03 } },
  typeLabel: 'Scuff',
  locationLabel: 'rear bumper',
  note: null,
};

function inputs(overrides: Partial<ComposeEvidenceInputs> = {}): ComposeEvidenceInputs {
  return {
    angleLabel: 'Front',
    rentalRef: 'R-0142',
    vehicleLabel: 'Renault Clio · AB-123-CD',
    dateLabel: 'Returned 15 Mar 2026, 17:40',
    agencyName: 'Coastline Rentals',
    before: { uri: 'file:///b_d2048.jpg', size: B, sha256: 'b'.repeat(64), timeLabel: 'Pick-up · 12 Mar 2026, 09:14' },
    after: { uri: 'file:///a_d2048.jpg', size: A, sha256: 'a'.repeat(64), timeLabel: 'Return · 15 Mar 2026, 17:40' },
    damages: [dent, scuff],
    ...overrides,
  };
}

describe('toEvidenceDamage', () => {
  it('draws a return mark on AFTER with the derived "same area" on BEFORE', () => {
    const d = toEvidenceDamage(dent, B, A);
    expect(d.status).toBe('new');
    expect(d.number).toBe('1');
    expect(d.primary).toBe('after');
    expect(d.after).toEqual(dent.marker.ring);
    expect(d.before).toEqual(deriveCounterpart(dent.marker.ring, 'afterToBefore', B, A));
  });

  it('prefers the stored counterpart and applies the alignment otherwise', () => {
    const override = { x: 0.6, y: 0.55, r: 0.08 };
    expect(toEvidenceDamage({ ...dent, marker: { ...dent.marker, counterpart: override } }, B, A).before).toEqual(override);
    const alignment = { dx: 0.02, dy: 0, scale: 1 };
    expect(toEvidenceDamage(dent, B, A, alignment).before).toEqual(deriveCounterpart(dent.marker.ring, 'afterToBefore', B, A, alignment));
  });

  it('keeps pick-up damage on BEFORE only, labelled with a letter', () => {
    const d = toEvidenceDamage({ ...scuff, number: 2 }, B, A);
    expect(d).toMatchObject({ status: 'existing', number: 'B', primary: 'before' });
    expect(d.after).toBeUndefined();
    expect(d.note).toBeUndefined();
  });

  it('treats "Was there" found at return as a solid ring on AFTER', () => {
    const d = toEvidenceDamage({ ...scuff, foundPhase: 'after' }, B, A);
    expect(d.primary).toBe('after');
    expect(d.after).toEqual(scuff.marker.ring);
    expect(d.before).toBeDefined();
  });
});

describe('toEvidenceLayoutInput', () => {
  it('builds the header and feeds a layout with DECISIONS marker rules and captions', () => {
    const li = toEvidenceLayoutInput(inputs({ agencyName: null }), 'foot');
    expect(li.subtitle).toBe('R-0142 · Renault Clio · AB-123-CD');
    expect(li.agencyName).toBeUndefined();
    expect(li.footnote).toBe('foot');
    const layout = computeEvidenceLayout(li);
    const primary = layout.markers.find((m) => m.status === 'new' && m.role === 'primary')!;
    expect(primary.panel).toBe('after');
    expect(primary.dashed).toBe(false);
    expect(primary.pin.shape).toBe('circle');
    const same = layout.markers.find((m) => m.status === 'new' && m.role === 'counterpart')!;
    expect(same.panel).toBe('before');
    expect(same.dashed).toBe(true);
    const existing = layout.markers.find((m) => m.status === 'existing')!;
    expect(existing.pin.shape).toBe('square');
    expect(existing.pin.label).toBe('A');
    const captions = layout.footer.rows.map((r) => r.text.lines.join(' '));
    expect(layout.footer.rows[0].text.lines[0].text).toBe('New 1 — Scratch, front bumper — Moderate');
    expect(layout.footer.rows[1].text.lines[0].text).toBe('Existing A — Scuff, rear bumper');
    expect(captions).toHaveLength(2);
  });

  it('omits the vehicle when unknown', () => {
    expect(toEvidenceLayoutInput(inputs({ vehicleLabel: null })).subtitle).toBe('R-0142');
  });
});

describe('composeEvidenceFingerprint / composeEvidenceInputHash', () => {
  it('is stable and ignores where the pixels are read from', () => {
    const a = composeEvidenceFingerprint(inputs());
    const moved = inputs();
    moved.before = { ...moved.before, uri: 'file:///elsewhere.jpg' };
    expect(composeEvidenceFingerprint(moved)).toBe(a);
  });

  it('changes with anything that changes the pixels', () => {
    const base = composeEvidenceFingerprint(inputs());
    const variants = [
      inputs({ after: { ...inputs().after, sha256: 'c'.repeat(64) } }),
      inputs({ damages: [{ ...dent, marker: { v: 1, ring: { x: 0.63, y: 0.58, r: 0.05 } } }, scuff] }),
      inputs({ damages: [{ ...dent, typeLabel: 'Dent' }, scuff] }),
      inputs({ damages: [{ ...dent, status: 'uncertain' }, scuff] }),
      inputs({ agencyName: 'Other agency' }),
      inputs({ alignment: { dx: 0.01, dy: 0, scale: 1 } }),
      inputs({ jpegQuality: 0.9 }),
      inputs({ longEdge: 2400 }),
    ].map(composeEvidenceFingerprint);
    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
  });

  it('hashes the fingerprint with SHA-256 and quotes it in the footnote', async () => {
    const h = await composeEvidenceInputHash(inputs());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await composeEvidenceInputHash(inputs())).toBe(h);
    expect(await composeEvidenceInputHash(inputs({ dateLabel: 'Returned 16 Mar 2026, 08:00' }))).not.toBe(h);
    expect(evidenceFootnote(inputs(), h)).toBe(`CarCheck · R-0142 · evidence ${h.slice(0, 8)} · photos bbbbbbbb/aaaaaaaa · originals unmodified`);
  });
});
