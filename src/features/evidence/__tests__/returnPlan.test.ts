import {
  compareSequence,
  compareStatus,
  listLabels,
  nextCaptureIndex,
  readinessSummary,
  returnCaptureTargets,
  returnReadiness,
} from '../returnPlan';
import { angleState, EXTERIOR, pair, photo } from './fixtures';

const reviewed = (angleKey: string) => angleState({ angleKey, reviewedAt: 1 });

describe('returnCaptureTargets', () => {
  it('walks the 8 exterior angles, then the dashboard, then pick-up extras', () => {
    const pairs = [
      ...EXTERIOR.map((k) => pair(k, { after: null })),
      pair('interior', { after: null, label: 'Interior' }),
      pair('closeup', { slot: 2, after: null, label: 'Close-up 2' }),
      pair('wheel', { before: null, after: null }),
    ];
    const targets = returnCaptureTargets(pairs);
    expect(targets.map((t) => `${t.angleKey}#${t.slot}`)).toEqual([
      ...EXTERIOR.map((k) => `${k}#1`),
      'dashboard#1',
      'interior#1',
      'closeup#2',
    ]);
    expect(targets.filter((t) => t.required)).toHaveLength(8);
    expect(targets.find((t) => t.angleKey === 'dashboard')?.state).toBe('pending');
  });

  it('marks photographed and skipped targets', () => {
    const pairs = EXTERIOR.map((k, i) =>
      pair(k, i === 0 ? {} : i === 1 ? { after: null, afterState: angleState({ angleKey: k, skippedAt: 5 }) } : { after: null }),
    );
    const states = returnCaptureTargets(pairs).map((t) => t.state);
    expect(states.slice(0, 3)).toEqual(['done', 'skipped', 'pending']);
  });
});

describe('nextCaptureIndex', () => {
  const targets = returnCaptureTargets(EXTERIOR.map((k, i) => pair(k, i < 3 || i === 5 ? {} : { after: null })));

  it('opens at the first pending angle', () => {
    expect(nextCaptureIndex(targets, null)).toBe(3);
  });

  it('advances past the current angle and wraps to earlier gaps', () => {
    expect(nextCaptureIndex(targets, 3)).toBe(4);
    expect(nextCaptureIndex(targets, 4)).toBe(6);
    expect(nextCaptureIndex(targets, 8)).toBe(3);
  });

  it('is null when nothing is pending', () => {
    const done = returnCaptureTargets([...EXTERIOR.map((k) => pair(k)), pair('dashboard')]);
    expect(nextCaptureIndex(done, null)).toBeNull();
  });
});

describe('compareSequence / compareStatus', () => {
  it('keeps exterior angles and photographed extras only', () => {
    const pairs = [pair('front'), pair('interior', { before: null, after: null }), pair('dashboard', { after: null })];
    expect(compareSequence(pairs).map((p) => p.angleKey)).toEqual(['front', 'dashboard']);
  });

  it('classifies each angle', () => {
    expect(compareStatus(pair('front', { afterState: reviewed('front') }))).toBe('reviewed');
    expect(compareStatus(pair('front'))).toBe('unreviewed');
    expect(compareStatus(pair('front', { after: null, afterState: angleState({ skippedAt: 1 }) }))).toBe('skipped');
    expect(compareStatus(pair('front', { after: null }))).toBe('missing');
    expect(compareStatus(pair('dashboard', { after: null }))).toBe('optional');
  });
});

describe('returnReadiness', () => {
  it('allows completion when every angle is reviewed or skipped', () => {
    const pairs = EXTERIOR.map((k, i) =>
      i === 7 ? pair(k, { after: null, afterState: angleState({ angleKey: k, skippedAt: 1 }) }) : pair(k, { afterState: reviewed(k) }),
    );
    const r = returnReadiness(pairs);
    expect(r.canComplete).toBe(true);
    expect(r.comparable).toBe(7);
    expect(r.reviewed).toBe(7);
  });

  it('blocks on unreviewed and missing angles', () => {
    const pairs = EXTERIOR.map((k, i) => (i === 0 ? pair(k) : i === 1 ? pair(k, { after: null }) : pair(k, { afterState: reviewed(k) })));
    const r = returnReadiness(pairs);
    expect(r.canComplete).toBe(false);
    expect(r.unreviewed.map((p) => p.angleKey)).toEqual(['front']);
    expect(r.missing.map((p) => p.angleKey)).toEqual(['front_left']);
  });

  it('does not block on an optional dashboard', () => {
    const pairs = [...EXTERIOR.map((k) => pair(k, { afterState: reviewed(k) })), pair('dashboard', { after: null })];
    expect(returnReadiness(pairs).canComplete).toBe(true);
  });

  it('never asks to view an optional shot that was taken but not opened in Compare', () => {
    const pairs = [...EXTERIOR.map((k) => pair(k, { afterState: reviewed(k) })), pair('dashboard'), pair('interior', { label: 'Interior' })];
    const r = returnReadiness(pairs);
    expect(r.unreviewed).toEqual([]);
    expect(r.canComplete).toBe(true);
  });

  it('lists retaken photos whose marks are unchecked, as a warning that never blocks', () => {
    const pairs = EXTERIOR.map((k) =>
      pair(k, { afterState: reviewed(k), after: photo('after', k, { marksCheckNeeded: k === 'rear' || k === 'left' }) }),
    );
    const r = returnReadiness(pairs);
    expect(r.marksToCheck.map((p) => p.angleKey)).toEqual(['left', 'rear']);
    expect(r.canComplete).toBe(true);
    expect(returnReadiness(EXTERIOR.map((k) => pair(k, { afterState: reviewed(k) }))).marksToCheck).toEqual([]);
  });

  it('needs at least one exterior return photo', () => {
    const pairs = EXTERIOR.map((k) => pair(k, { after: null, afterState: angleState({ angleKey: k, skippedAt: 1 }) }));
    const r = returnReadiness(pairs);
    expect(r.hasExteriorPhoto).toBe(false);
    expect(r.canComplete).toBe(false);
  });

  it('summarises counts', () => {
    const pairs = [
      pair('front', { newDamageCount: 2, afterState: reviewed('front') }),
      pair('rear', { uncertainDamageCount: 1 }),
      pair('left', { before: photo('before', 'left'), after: null }),
    ];
    expect(readinessSummary(returnReadiness(pairs))).toBe('2 new · 1 uncertain · 1 of 2 angles compared');
    expect(readinessSummary(returnReadiness([pair('front', { afterState: reviewed('front') })]))).toBe(
      'No new damage · 1 of 1 angle compared',
    );
  });
});

describe('listLabels', () => {
  it('joins with commas and "and"', () => {
    expect(listLabels([{ label: 'Rear' }])).toBe('Rear');
    expect(listLabels([{ label: 'Rear' }, { label: 'Left' }, { label: 'Right' }])).toBe('Rear, Left and Right');
  });
});
