import {
  damageDescription,
  damageMark,
  damageTitle,
  formatDate,
  formatDateTime,
  formatEdgeCodeTime,
  formatFuel,
  formatInteger,
  formatTimestampWithZone,
  formatUtcOffset,
  humanizeAngleKey,
  shortHash,
} from '../format';
import { cssString, escapeHtml, escapeMultiline, safeImageSrc } from '../html/escape';
import { fitLongEdge } from '../sizing';
import { T0 } from './fixtures';

describe('date formatting', () => {
  it('prints local time from the stored UTC offset, independent of the machine zone', () => {
    expect(formatDateTime(T0, 120)).toBe('24 Sep 2026, 17:05');
    expect(formatDateTime(T0, -300)).toBe('24 Sep 2026, 10:05');
    expect(formatDate(T0, 600)).toBe('25 Sep 2026');
    expect(formatEdgeCodeTime(T0, 120)).toBe('24.09.2026 17:05');
  });

  it('prints evidence timestamps with seconds and zone', () => {
    expect(formatTimestampWithZone(T0, 120)).toBe('24 Sep 2026, 17:05:32 (UTC+02:00)');
    expect(formatUtcOffset(0)).toBe('UTC');
    expect(formatUtcOffset(-330)).toBe('UTC-05:30');
  });
});

describe('numbers and labels', () => {
  it('groups digits and names fuel levels', () => {
    expect(formatInteger(1234567)).toBe('1 234 567');
    expect(formatInteger(999)).toBe('999');
    expect(formatFuel(8)).toBe('Full');
    expect(formatFuel(2)).toBe('¼');
    expect(formatFuel(3)).toBe('3/8');
    expect(formatFuel(null)).toBeNull();
  });

  it('letters existing damage and adds "?" to uncertain', () => {
    expect(damageMark('pre_existing', 1)).toBe('A');
    expect(damageMark('pre_existing', 27)).toBe('AA');
    expect(damageMark('new', 3)).toBe('3');
    expect(damageTitle('uncertain', 2)).toBe('Uncertain 2?');
    expect(damageTitle('pre_existing', 2)).toBe('Existing B');
    expect(damageDescription('dent', ' rear bumper ')).toBe('Dent, rear bumper');
    expect(damageDescription(null, null)).toBe('Damage (type not set)');
    expect(humanizeAngleKey('front_left')).toBe('Front left');
  });

  it('shortens hashes to 16 grouped hex digits', () => {
    expect(shortHash('3F9A1C2B77D0E41D' + 'f'.repeat(48))).toBe('3f9a 1c2b 77d0 e41d');
  });
});

describe('escaping', () => {
  it('escapes text, attributes and CSS strings', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(escapeMultiline('a<b\r\nc')).toBe('a&lt;b<br>c');
    expect(cssString('Say "hi" \\ </style>')).toBe('"Say \\"hi\\" \\\\ \\3C /style>"');
  });

  it('only accepts image data URIs as sources', () => {
    expect(safeImageSrc('data:image/jpeg;base64,AAAA')).toBe('data:image/jpeg;base64,AAAA');
    expect(safeImageSrc('file:///data/photo.jpg')).toBeNull();
    expect(safeImageSrc('javascript:alert(1)')).toBeNull();
    expect(safeImageSrc(null)).toBeNull();
  });
});

describe('fitLongEdge', () => {
  it('downscales to the long edge and never upscales', () => {
    expect(fitLongEdge({ width: 4032, height: 3024 }, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitLongEdge({ width: 1592, height: 2800 }, 1600)).toEqual({ width: 910, height: 1600 });
    expect(fitLongEdge({ width: 800, height: 600 }, 1600)).toBeNull();
  });
});
