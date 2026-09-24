import {
  calendarDayOffset,
  formatDate,
  formatDateLong,
  formatDateTime,
  formatEdgeTimestamp,
  formatFileSize,
  formatMileage,
  formatPlate,
  formatRelativeDateTime,
  formatTime,
  markerLabel,
  normalizePlate,
  plural,
} from '../format';

// Dates are built from local components so the assertions hold in any machine time zone.
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 9, 24, 13, 32); // Thu 24 Sep 2026
const L = 'en-GB';

describe('dates', () => {
  it('formats time with the locale clock', () => {
    expect(formatTime(at(2026, 9, 24, 17, 5), L)).toBe('17:05');
    expect(formatTime(at(2026, 9, 24, 17, 5), 'en-US')).toMatch(/^05:05\sPM$/);
  });

  it('formats short dates and adds the year only when it differs', () => {
    expect(formatDate(at(2026, 9, 27), L, NOW)).toBe(`Sun 27 ${formatSept()}`);
    expect(formatDate(at(2025, 12, 30), L, NOW)).toMatch(/^Tue,? 30 Dec 2025$/);
    expect(formatDateTime(at(2026, 9, 27, 10), L, NOW)).toBe(`Sun 27 ${formatSept()}, 10:00`);
  });

  it('formats the long signature date', () => {
    expect(formatDateLong(at(2026, 9, 24), L)).toMatch(/^Thursday,? 24 September 2026$/);
  });

  it('counts calendar days, not 24h blocks', () => {
    expect(calendarDayOffset(at(2026, 9, 25, 0, 5), at(2026, 9, 24, 23, 55))).toBe(1);
    expect(calendarDayOffset(at(2026, 9, 24, 0, 0), NOW)).toBe(0);
    expect(calendarDayOffset(at(2026, 9, 20), NOW)).toBe(-4);
  });

  it('uses relative words where they help', () => {
    expect(formatRelativeDateTime(at(2026, 9, 24, 17, 40), NOW, L)).toBe('Today 17:40');
    expect(formatRelativeDateTime(at(2026, 9, 25, 9), NOW, L)).toBe('Tomorrow 09:00');
    expect(formatRelativeDateTime(at(2026, 9, 23, 10), NOW, L)).toBe('Yesterday 10:00');
    expect(formatRelativeDateTime(at(2026, 9, 27, 18), NOW, L)).toBe('Sun 18:00');
    expect(formatRelativeDateTime(at(2026, 10, 2, 10), NOW, L)).toBe('Fri 2 Oct, 10:00');
    expect(formatRelativeDateTime(at(2026, 9, 12, 9, 41), NOW, L)).toBe(`Sat 12 ${formatSept()}, 09:41`);
  });

  it('formats edge-code timestamps', () => {
    expect(formatEdgeTimestamp(at(2026, 9, 24, 10, 4), L)).toBe(`24 ${formatSept()} 2026 10:04`);
  });
});

// ICU versions disagree on the en-GB short form of September ("Sep" vs "Sept"), and on the comma
// after a long weekday; the tests pin the structure, not the ICU data.
function formatSept() {
  return new Intl.DateTimeFormat(L, { month: 'short' }).format(new Date(2026, 8, 1));
}

describe('numbers', () => {
  it('formats mileage with grouping and unit', () => {
    expect(formatMileage(48213, 'km', L)).toBe('48,213 km');
    expect(formatMileage(48213.6, 'mi', L)).toBe('48,214 mi');
    expect(formatMileage(null, 'km', L)).toBe('');
    expect(formatMileage(Number.NaN, 'km', L)).toBe('');
  });

  it('formats file sizes in SI units', () => {
    expect(formatFileSize(512, L)).toBe('512 B');
    expect(formatFileSize(320_000_000, L)).toBe('320 MB');
    expect(formatFileSize(1_234_000_000, L)).toBe('1.2 GB');
    expect(formatFileSize(-1, L)).toBe('');
  });
});

describe('plates', () => {
  it('displays plates upper-case with the typed separators', () => {
    expect(formatPlate('  31-qm-07 ')).toBe('31-QM-07');
    expect(formatPlate('ab  123   cd')).toBe('AB 123 CD');
    expect(formatPlate(null)).toBe('');
  });

  it('normalizes plates for matching', () => {
    expect(normalizePlate('ab 123-cd')).toBe(normalizePlate('AB-123-CD'));
    expect(normalizePlate('ab·12.3/cd')).toBe('AB123CD');
  });
});

describe('markerLabel', () => {
  it('letters pre-existing damage', () => {
    expect(markerLabel('pre_existing', 1)).toBe('A');
    expect(markerLabel('pre_existing', 26)).toBe('Z');
    expect(markerLabel('pre_existing', 27)).toBe('AA');
    expect(markerLabel('pre_existing', 53)).toBe('BA');
  });

  it('numbers new and uncertain damage', () => {
    expect(markerLabel('new', 3)).toBe('3');
    expect(markerLabel('uncertain', 2)).toBe('2?');
    expect(markerLabel('new', 0)).toBe('1');
  });
});

describe('plural', () => {
  it('picks one or other and substitutes the count', () => {
    expect(plural(1, '{n} mark', '{n} marks')).toBe('1 mark');
    expect(plural(3, '{n} mark', '{n} marks')).toBe('3 marks');
  });
});
