import {
  changedValues,
  cleanNote,
  damageRowDetail,
  damageRowTitle,
  initialValues,
  previewBadgeLabel,
  statusLine,
} from '../damageForm';

describe('damageForm', () => {
  it('pick-up marks are always existing', () => {
    expect(initialValues('pre_existing', { status: 'new' }).status).toBe('pre_existing');
    expect(initialValues('return').status).toBe('new');
    expect(initialValues('return', { status: 'uncertain', type: 'dent' })).toEqual({
      status: 'uncertain',
      type: 'dent',
      severity: null,
      note: null,
    });
  });

  it('describes the status', () => {
    expect(statusLine('pre_existing', 'pre_existing')).toBe('Existing · already there at pick-up');
    expect(statusLine('return', 'pre_existing')).toBe('Was there · missed at pick-up');
  });

  it('keeps the number between new and uncertain, drops it when moving to letters', () => {
    expect(previewBadgeLabel('new', 'uncertain', '3')).toBe('3?');
    expect(previewBadgeLabel('uncertain', 'new', '3?')).toBe('3');
    expect(previewBadgeLabel('new', 'pre_existing', '3')).toBe('');
    expect(previewBadgeLabel('pre_existing', 'pre_existing', 'A')).toBe('A');
  });

  it('reports only changed fields, treating blank notes as none', () => {
    const before = { status: 'new' as const, type: null, severity: null, note: null };
    expect(changedValues(before, { ...before, note: '   ' })).toEqual({});
    expect(changedValues(before, { ...before, type: 'scratch', note: ' dent ' })).toEqual({ type: 'scratch', note: 'dent' });
    expect(cleanNote('')).toBeNull();
  });

  it('formats list rows', () => {
    expect(damageRowTitle({ status: 'pre_existing', number: 1, type: 'scratch' })).toBe('Existing A · Scratch');
    expect(damageRowTitle({ status: 'new', number: 2, type: null })).toBe('New 2 · Damage (type not set)');
    expect(damageRowDetail({ severity: 'minor', note: 'left', locationLabel: null })).toBe('Minor · “left”');
    expect(damageRowDetail({ severity: null, note: null, locationLabel: null })).toBeNull();
  });
});
