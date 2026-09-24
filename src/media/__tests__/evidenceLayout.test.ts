import {
  approximateMeasure,
  computeEvidenceLayout,
  evidenceFingerprint,
  legibilityScore,
  orderedDamages,
  wrapText,
  type EvidenceDamage,
  type EvidenceLayout,
  type EvidenceLayoutInput,
  type TextBlock,
} from '../evidenceLayout';
import { badgeExtent, ringToRect, type Rect, type Size } from '../geometry';

const LANDSCAPE: Size = { width: 4000, height: 3000 };
const PORTRAIT: Size = { width: 3000, height: 4000 };

const newDent: EvidenceDamage = {
  status: 'new',
  number: '2',
  typeLabel: 'Dent',
  locationLabel: 'rear bumper',
  severityLabel: 'Moderate',
  after: { x: 0.62, y: 0.58, r: 0.05 },
  before: { x: 0.62, y: 0.58, r: 0.0575 },
};

function input(overrides: Partial<EvidenceLayoutInput> = {}): EvidenceLayoutInput {
  return {
    angleLabel: 'Rear left',
    subtitle: 'R-0142 · Renault Clio · AB-123-CD',
    dateLabel: 'Returned 15 Mar 2026, 17:40',
    agencyName: 'Coastline Rentals (sample)',
    before: { size: LANDSCAPE, timeLabel: 'Pick-up · 12 Mar 2026, 09:14' },
    after: { size: LANDSCAPE, timeLabel: 'Return · 15 Mar 2026, 17:40' },
    damages: [newDent],
    footnote: 'CarCheck · evidence 3f9a1c2e · photos 9b1e…/c04d…',
    ...overrides,
  };
}

function inside(inner: Rect, outer: Rect, eps = 0.5) {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.width <= outer.x + outer.width + eps &&
    inner.y + inner.height <= outer.y + outer.height + eps
  );
}

function canvasRect(l: EvidenceLayout): Rect {
  return { x: 0, y: 0, width: l.canvas.width, height: l.canvas.height };
}

function allTexts(l: EvidenceLayout): TextBlock[] {
  const out: TextBlock[] = [...l.header.texts, l.panels.before.label, l.panels.before.time, l.panels.after.label, l.panels.after.time, l.footer.legend];
  if (l.footer.footnote) out.push(l.footer.footnote);
  for (const row of l.footer.rows) {
    out.push(row.text);
    if (row.note) out.push(row.note);
  }
  return out;
}

/** Every text line lies horizontally inside the canvas margins. */
function expectTextInside(l: EvidenceLayout) {
  for (const b of allTexts(l)) {
    for (const line of b.lines) {
      const w = approximateMeasure(line.text, b.fontSize, b.weight);
      expect(line.x).toBeGreaterThanOrEqual(-0.5);
      expect(line.x + w).toBeLessThanOrEqual(l.canvas.width + 0.5);
      expect(line.y).toBeLessThanOrEqual(l.canvas.height);
    }
  }
}

function expectPanelsSound(l: EvidenceLayout, before: Size, after: Size) {
  const { before: b, after: a } = l.panels;
  for (const [p, size] of [
    [b, before],
    [a, after],
  ] as const) {
    expect(inside(p.imageRect, p.box)).toBe(true);
    expect(inside(p.box, canvasRect(l))).toBe(true);
    expect(p.imageRect.width / p.imageRect.height).toBeCloseTo(size.width / size.height, 3);
  }
  // Panels never overlap.
  const overlapX = b.box.x < a.box.x + a.box.width && a.box.x < b.box.x + b.box.width;
  const overlapY = b.box.y < a.box.y + a.box.height && a.box.y < b.box.y + b.box.height;
  expect(overlapX && overlapY).toBe(false);
  // Header above panels, footer below.
  expect(Math.min(b.box.y, a.box.y)).toBeGreaterThan(l.header.dividerY);
  expect(l.footer.rect.y).toBeGreaterThan(Math.max(b.box.y + b.box.height, a.box.y + a.box.height));
}

describe('computeEvidenceLayout — orientation', () => {
  it('stacks a landscape pair (BEFORE on top) and hits the target long edge', () => {
    const l = computeEvidenceLayout(input());
    expect(l.arrangement).toBe('stacked');
    expect(l.panels.before.box.y).toBeLessThan(l.panels.after.box.y);
    const le = Math.max(l.canvas.width, l.canvas.height);
    expect(le).toBeLessThanOrEqual(2800);
    expect(le).toBeGreaterThanOrEqual(2800 * 0.98);
    expect(l.exceedsTargetLongEdge).toBe(false);
    expectPanelsSound(l, LANDSCAPE, LANDSCAPE);
    expectTextInside(l);
  });

  it('puts a portrait pair side by side (BEFORE on the left)', () => {
    const l = computeEvidenceLayout(input({ before: { size: PORTRAIT, timeLabel: 'a' }, after: { size: PORTRAIT, timeLabel: 'b' } }));
    expect(l.arrangement).toBe('sideBySide');
    expect(l.panels.before.box.x).toBeLessThan(l.panels.after.box.x);
    expect(l.panels.before.box.height).toBeCloseTo(l.panels.after.box.height);
    expect(Math.max(l.canvas.width, l.canvas.height)).toBeLessThanOrEqual(2800);
    expectPanelsSound(l, PORTRAIT, PORTRAIT);
    expectTextInside(l);
  });

  it('handles a mixed pair and picks the more legible arrangement', () => {
    const inp = input({ before: { size: PORTRAIT, timeLabel: 'a' }, after: { size: LANDSCAPE, timeLabel: 'b' } });
    const auto = computeEvidenceLayout(inp);
    const stacked = computeEvidenceLayout(inp, { arrangement: 'stacked' });
    const side = computeEvidenceLayout(inp, { arrangement: 'sideBySide' });
    expect(legibilityScore(auto)).toBeCloseTo(Math.max(legibilityScore(stacked), legibilityScore(side)));
    for (const l of [stacked, side]) {
      expectPanelsSound(l, PORTRAIT, LANDSCAPE);
      expectTextInside(l);
    }
  });

  it('respects a forced arrangement and a custom long edge', () => {
    const l = computeEvidenceLayout(input(), { arrangement: 'sideBySide', longEdge: 2400 });
    expect(l.arrangement).toBe('sideBySide');
    expect(l.canvas.width).toBe(2400);
    expect(l.canvas.height).toBeLessThan(2400);
  });

  it('never needs more than the 2048 px display derivative at the default size', () => {
    const cases: [Size, Size][] = [
      [LANDSCAPE, LANDSCAPE],
      [PORTRAIT, PORTRAIT],
      [PORTRAIT, LANDSCAPE],
      [
        { width: 2250, height: 4000 },
        { width: 2250, height: 4000 },
      ],
    ];
    for (const [b, a] of cases) {
      const l = computeEvidenceLayout(input({ before: { size: b, timeLabel: 'a' }, after: { size: a, timeLabel: 'b' } }));
      expect(l.panels.before.requiredSourceLongEdge).toBeLessThanOrEqual(2048);
      expect(l.panels.after.requiredSourceLongEdge).toBeLessThanOrEqual(2048);
    }
  });
});

describe('computeEvidenceLayout — markers', () => {
  const uncertain: EvidenceDamage = {
    status: 'uncertain',
    number: '3',
    typeLabel: 'Scratch',
    after: { x: 0.2, y: 0.3, r: 0.04 },
    before: { x: 0.2, y: 0.3, r: 0.046 },
  };
  const existing: EvidenceDamage = {
    status: 'existing',
    number: '1',
    typeLabel: 'Chip',
    locationLabel: 'rear light',
    before: { x: 0.8, y: 0.4, r: 0.03 },
    after: { x: 0.8, y: 0.4, r: 0.0345 },
  };

  it('places rings where the normalized ring maps on each photo', () => {
    const l = computeEvidenceLayout(input());
    const onAfter = l.markers.find((m) => m.panel === 'after')!;
    const expected = ringToRect(newDent.after!, l.panels.after.imageRect);
    expect(onAfter.ring.cx).toBeCloseTo(expected.cx);
    expect(onAfter.ring.cy).toBeCloseTo(expected.cy);
    expect(onAfter.ring.r).toBeCloseTo(expected.r);
    expect(onAfter.clip).toEqual(l.panels.after.imageRect);
  });

  it('gives each status a different shape, not just a different colour', () => {
    const l = computeEvidenceLayout(input({ damages: [existing, uncertain, newDent] }));
    const shapeOf = (status: string, role: string) => {
      const m = l.markers.find((x) => x.status === status && x.role === role)!;
      return `${m.dashed ? 'dashed' : 'solid'}/${m.pin.shape}/${m.pin.fill}/${m.pin.label}`;
    };
    // DECISIONS.md: shape = status, dashed = "same area on the other photo" only.
    expect(shapeOf('new', 'primary')).toBe('solid/circle/solid/2');
    expect(shapeOf('uncertain', 'primary')).toBe('solid/diamond/solid/3?');
    expect(shapeOf('existing', 'primary')).toBe('solid/square/hollow/1');
    // Counterparts are dashed with hollow pins that repeat the label.
    expect(shapeOf('new', 'counterpart')).toBe('dashed/circle/hollow/2');
    expect(shapeOf('uncertain', 'counterpart')).toBe('dashed/diamond/hollow/3?');
    expect(shapeOf('existing', 'counterpart')).toBe('dashed/square/hollow/1');
    // Primary sides: new/uncertain on AFTER, existing on BEFORE.
    expect(l.markers.find((m) => m.status === 'new' && m.role === 'primary')!.panel).toBe('after');
    expect(l.markers.find((m) => m.status === 'existing' && m.role === 'primary')!.panel).toBe('before');
    // Footer pins repeat the pin shape so the caption list is readable in black and white.
    const footer = l.footer.rows.map((r) => `${r.pin.shape}/${r.pin.fill}/${r.pin.dashed}`);
    expect(footer).toEqual(['circle/solid/false', 'diamond/solid/false', 'square/hollow/false']);
    expect(l.footer.rows[1].text.lines[0].text.startsWith('Uncertain 3?')).toBe(true);
  });

  it('puts the solid ring on AFTER for existing damage found at return', () => {
    const wasThere: EvidenceDamage = { ...existing, primary: 'after' };
    const l = computeEvidenceLayout(input({ damages: [wasThere] }));
    const onAfter = l.markers.find((m) => m.panel === 'after')!;
    const onBefore = l.markers.find((m) => m.panel === 'before')!;
    expect(onAfter.role).toBe('primary');
    expect(onAfter.dashed).toBe(false);
    expect(onBefore.role).toBe('counterpart');
    expect(onBefore.dashed).toBe(true);
  });

  it('draws counterparts first and new/uncertain primaries last', () => {
    const l = computeEvidenceLayout(input({ damages: [newDent, existing, uncertain] }));
    const ranks = l.markers.map((m) => (m.role === 'counterpart' ? 0 : m.status === 'existing' ? 1 : 2));
    expect([...ranks].sort()).toEqual(ranks);
  });

  it('enforces a minimum ring size and keeps pins inside the photo', () => {
    const tiny: EvidenceDamage = { ...newDent, after: { x: 0.995, y: 0.005, r: 0.001 }, before: undefined };
    const l = computeEvidenceLayout(input({ damages: [tiny] }));
    const m = l.markers[0];
    const img = l.panels.after.imageRect;
    expect(m.ring.r).toBeGreaterThan(ringToRect(tiny.after!, img).r * 5);
    const pinBox = { x: m.pin.cx - m.pin.r, y: m.pin.cy - m.pin.r, width: 2 * m.pin.r, height: 2 * m.pin.r };
    expect(inside(pinBox, img)).toBe(true);
    expect(l.markers).toHaveLength(1); // no BEFORE ring when none is supplied
  });

  it('keeps whole badge shapes (square corners, diamond points) off the photo edge', () => {
    for (const d of [
      { ...uncertain, after: { x: 0.99, y: 0.02, r: 0.05 } },
      { ...existing, before: { x: 0.01, y: 0.98, r: 0.02 } },
    ] as EvidenceDamage[]) {
      const l = computeEvidenceLayout(input({ damages: [d] }));
      for (const m of l.markers) {
        const e = badgeExtent(m.pin.shape, m.pin.r);
        const img = m.panel === 'after' ? l.panels.after.imageRect : l.panels.before.imageRect;
        expect(inside({ x: m.pin.cx - e, y: m.pin.cy - e, width: 2 * e, height: 2 * e }, img, 1)).toBe(true);
      }
    }
  });

  it('scales marker strokes with the photo size in the output', () => {
    const small = computeEvidenceLayout(input(), { longEdge: 2000 });
    const large = computeEvidenceLayout(input(), { longEdge: 3000 });
    expect(large.markerStyle.strokeWidth).toBeGreaterThan(small.markerStyle.strokeWidth);
    expect(large.markerStyle.haloWidth).toBeGreaterThan(large.markerStyle.strokeWidth);
    expect(large.markerStyle.edgeWidth).toBeGreaterThan(large.markerStyle.haloWidth);
  });
});

describe('computeEvidenceLayout — footer and text', () => {
  function manyDamages(n: number, long = false): EvidenceDamage[] {
    return Array.from({ length: n }, (_, i) => ({
      status: i % 3 === 0 ? 'uncertain' : 'new',
      number: String(i + 1),
      typeLabel: long ? 'Deep scratch through clear coat and primer with visible bare metal' : 'Scratch',
      locationLabel: long ? 'lower edge of the rear left passenger door next to the sill cover trim' : 'door',
      severityLabel: 'Severe',
      note: long ? 'Customer says it happened in a car park while the car was parked and nobody saw anything' : undefined,
      after: { x: (i % 5) / 5 + 0.1, y: Math.floor(i / 5) / 10 + 0.1, r: 0.03 },
    })) as EvidenceDamage[];
  }

  it('lists every damage, switching to two columns for many', () => {
    const l = computeEvidenceLayout(input({ damages: manyDamages(12) }));
    expect(l.footer.columns).toBe(2);
    expect(l.footer.rows).toHaveLength(12);
    for (const row of l.footer.rows) expect(inside(row.rect, canvasRect(l))).toBe(true);
    // Rows in the same column never overlap.
    const byCol = new Map<number, Rect[]>();
    for (const row of l.footer.rows) byCol.set(row.rect.x, [...(byCol.get(row.rect.x) ?? []), row.rect]);
    for (const rects of byCol.values()) {
      for (let i = 1; i < rects.length; i++) expect(rects[i].y).toBeGreaterThanOrEqual(rects[i - 1].y + rects[i - 1].height);
    }
    expectTextInside(l);
  });

  it('uses one column for a few damages', () => {
    expect(computeEvidenceLayout(input()).footer.columns).toBe(1);
  });

  it('wraps long captions to at most two lines and ellipsizes notes', () => {
    // Four damages => two narrow columns, so these captions cannot fit in two lines.
    const l = computeEvidenceLayout(input({ damages: manyDamages(4, true) }));
    expect(l.footer.columns).toBe(2);
    for (const row of l.footer.rows) {
      expect(row.text.lines.length).toBeLessThanOrEqual(2);
      expect(row.text.lines[row.text.lines.length - 1].text.endsWith('…')).toBe(true);
      expect(row.note!.lines).toHaveLength(1);
      const textRight = row.rect.x + row.rect.width;
      for (const b of [row.text, row.note!]) {
        for (const line of b.lines) {
          expect(line.x + approximateMeasure(line.text, b.fontSize, b.weight)).toBeLessThanOrEqual(textRight + 0.5);
        }
      }
    }
    expectTextInside(l);
  });

  it('grows instead of dropping captions when there are very many', () => {
    const l = computeEvidenceLayout(input({ damages: manyDamages(40, true) }));
    expect(l.footer.rows).toHaveLength(40);
    const last = l.footer.rows[l.footer.rows.length - 1];
    expect(last.rect.y + last.rect.height).toBeLessThanOrEqual(l.canvas.height);
    expectTextInside(l);
  });

  it('shrinks then ellipsizes a long angle title without hitting the date column', () => {
    const l = computeEvidenceLayout(
      input({ angleLabel: 'Rear left — close-up of the wheel arch, lower door sill and the rear bumper corner cover' }),
    );
    const [title] = l.header.texts;
    const date = l.header.texts[2];
    const titleRight = title.lines[0].x + approximateMeasure(title.lines[0].text, title.fontSize, 'bold');
    expect(titleRight).toBeLessThan(date.lines[0].x);
    expect(title.lines[0].text.endsWith('…')).toBe(true);
  });

  it('renders a valid image with no damages', () => {
    const l = computeEvidenceLayout(input({ damages: [], agencyName: undefined, footnote: undefined }));
    expect(l.footer.rows).toHaveLength(0);
    expect(l.markers).toHaveLength(0);
    expect(l.footer.footnote).toBeNull();
    expect(l.footer.legend.lines).toHaveLength(1);
    expectTextInside(l);
  });

  it('orders damages new, uncertain, existing and keeps caller order within a group', () => {
    const d = (status: EvidenceDamage['status'], number: string): EvidenceDamage => ({ status, number, typeLabel: 'x' });
    const ordered = orderedDamages([d('existing', '1'), d('new', '4'), d('uncertain', '5'), d('new', '2')]);
    expect(ordered.map((x) => `${x.status}${x.number}`)).toEqual(['new4', 'new2', 'uncertain5', 'existing1']);
  });
});

describe('wrapText', () => {
  it('breaks over-long words and respects the width', () => {
    const lines = wrapText('Supercalifragilisticexpialidocious bumper', 200, 30, 'regular', approximateMeasure, 5);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(approximateMeasure(line, 30, 'regular')).toBeLessThanOrEqual(200);
  });
});

describe('evidenceFingerprint', () => {
  const identity = { beforeSha256: 'aa', afterSha256: 'bb', fontId: 'Inter-4.1', longEdge: 2800, jpegQuality: 85 };

  it('is stable under key order and ignores the footnote', () => {
    const a = input();
    const reordered = JSON.parse(JSON.stringify({ ...a, footnote: 'different' })) as EvidenceLayoutInput;
    const b: EvidenceLayoutInput = {
      damages: reordered.damages,
      after: reordered.after,
      before: reordered.before,
      angleLabel: reordered.angleLabel,
      subtitle: reordered.subtitle,
      dateLabel: reordered.dateLabel,
      agencyName: reordered.agencyName,
      footnote: reordered.footnote,
    };
    expect(evidenceFingerprint(b, identity)).toBe(evidenceFingerprint(a, identity));
  });

  it('changes when a marker moves, a label changes or a source photo changes', () => {
    const base = evidenceFingerprint(input(), identity);
    const moved = evidenceFingerprint(input({ damages: [{ ...newDent, after: { x: 0.63, y: 0.58, r: 0.05 } }] }), identity);
    const relabelled = evidenceFingerprint(input({ damages: [{ ...newDent, typeLabel: 'Scratch' }] }), identity);
    const rephotographed = evidenceFingerprint(input(), { ...identity, afterSha256: 'cc' });
    expect(new Set([base, moved, relabelled, rephotographed]).size).toBe(4);
  });
});
