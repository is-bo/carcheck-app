import type { InspectionAngleView } from '@/domain/types';

import {
  doneCount,
  initialTarget,
  missingAngles,
  nextTarget,
  orbitStates,
  progressFromViews,
  withCaptured,
  withSkipped,
  type CaptureProgressState,
} from '../captureSequence';

const ALL = ['front', 'front_left', 'left', 'rear_left', 'rear', 'rear_right', 'right', 'front_right'];

const state = (captured: string[] = [], skipped: string[] = []): CaptureProgressState => ({
  captured: new Set(captured),
  skipped: new Set(skipped),
});

describe('captureSequence', () => {
  it('opens at the first missing angle in walk order', () => {
    expect(initialTarget(state())).toEqual({ kind: 'angle', angleKey: 'front' });
    expect(initialTarget(state(['front', 'front_left'], ['left']))).toEqual({ kind: 'angle', angleKey: 'rear_left' });
  });

  it('honours a requested angle, including already captured ones (retake)', () => {
    expect(initialTarget(state(['rear']), 'rear')).toEqual({ kind: 'angle', angleKey: 'rear' });
    expect(initialTarget(state(), 'dashboard')).toEqual({ kind: 'dashboard' });
  });

  it('goes to the dashboard once every exterior angle is done, then finishes', () => {
    expect(initialTarget(state(ALL))).toEqual({ kind: 'dashboard' });
    expect(initialTarget(state(ALL, ['dashboard']))).toEqual({ kind: 'finish' });
  });

  it('advances to the next missing angle after the current one and wraps around', () => {
    expect(nextTarget(state(['rear', 'rear_right', 'right', 'front_right']), 'front_right')).toEqual({ kind: 'angle', angleKey: 'front' });
    expect(nextTarget(state(['front']), 'front')).toEqual({ kind: 'angle', angleKey: 'front_left' });
  });

  it('after the dashboard, returns to any angle still missing', () => {
    expect(nextTarget(state(['front'], ['dashboard']), 'dashboard')).toEqual({ kind: 'angle', angleKey: 'front_left' });
    expect(nextTarget(state(ALL, ['dashboard']), 'dashboard')).toEqual({ kind: 'finish' });
  });

  it('a retake of an earlier angle continues with the missing ones', () => {
    const s = state(ALL.filter((k) => k !== 'front_right'));
    expect(nextTarget(s, 'left')).toEqual({ kind: 'angle', angleKey: 'front_right' });
  });

  it('capturing clears an earlier skip', () => {
    const s = withCaptured(withSkipped(state(), 'left'), 'left');
    expect(s.skipped.has('left')).toBe(false);
    expect(s.captured.has('left')).toBe(true);
  });

  it('counts and diagram states cover only the 8 exterior angles', () => {
    const s = state(['front', 'dashboard'], ['rear']);
    expect(doneCount(s)).toBe(2);
    expect(missingAngles(s)).toHaveLength(6);
    expect(orbitStates(s)).toEqual({ front: 'done', rear: 'skipped' });
  });

  it('reads stored views (slot 1 only)', () => {
    const view = (angleKey: string, slot: number, photo: boolean, skipped: boolean) =>
      ({
        angleKey,
        slot,
        label: angleKey,
        group: 'exterior',
        photo: photo ? { id: 'p' } : null,
        state: skipped ? { skippedAt: 1 } : null,
        damageCount: 0,
      }) as unknown as InspectionAngleView;
    const s = progressFromViews([view('front', 1, true, false), view('left', 1, false, true), view('closeup', 2, true, false)]);
    expect([...s.captured]).toEqual(['front']);
    expect([...s.skipped]).toEqual(['left']);
  });
});
