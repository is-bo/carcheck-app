import { atHour, fuelSegment, parseMileage, presetOf, returnAtPreset, shiftDays, shiftTime } from '../detailsForm';

describe('detailsForm', () => {
  const now = new Date(2026, 8, 24, 10, 37, 22).getTime();

  it('maps fuel eighths onto the five segments', () => {
    expect(fuelSegment(null)).toBeNull();
    expect(fuelSegment(0)).toBe('0');
    expect(fuelSegment(3)).toBe('4');
    expect(fuelSegment(8)).toBe('8');
    expect(fuelSegment(11)).toBe('8');
  });

  it('keeps the current time for return presets', () => {
    const at = new Date(returnAtPreset('3d', now));
    expect([at.getDate(), at.getHours(), at.getMinutes(), at.getSeconds()]).toEqual([27, 10, 37, 0]);
    expect(new Date(returnAtPreset('1w', now)).getMonth()).toBe(9);
  });

  it('recognises which chip produced a date', () => {
    expect(presetOf(returnAtPreset('2d', now), now)).toBe('2d');
    expect(presetOf(shiftDays(now, 5), now)).toBeNull();
    expect(presetOf(null, now)).toBeNull();
  });

  it('steps time on a 15-minute grid', () => {
    const up = new Date(shiftTime(now, 1));
    expect([up.getHours(), up.getMinutes()]).toEqual([10, 45]);
    const down = new Date(shiftTime(now, -1));
    expect([down.getHours(), down.getMinutes()]).toEqual([10, 30]);
  });

  it('parses typed mileage', () => {
    expect(parseMileage('')).toBeNull();
    expect(parseMileage('48 213')).toBe(48213);
    expect(parseMileage('48,213')).toBe(48213);
    expect(parseMileage('12a')).toBe('invalid');
  });
});

describe('atHour', () => {
  it('keeps the day and sets the time on the hour', () => {
    const at = new Date(2026, 8, 24, 16, 37, 12).getTime();
    expect(new Date(atHour(at, 9))).toEqual(new Date(2026, 8, 24, 9, 0, 0, 0));
  });
});
