import {
  DISPLAY_LONG_EDGE,
  fitLongEdge,
  isJpeg,
  jpegExifOrientation,
  ORIGINAL_TARGET_LONG_EDGE,
  sameSize,
  THUMB_LONG_EDGE,
  toHex,
} from '../photoMath';

// --- tiny JPEG header builder (only the segments the parser reads) ---------------------------

const u16 = (v: number, le: boolean) => (le ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
const u32 = (v: number, le: boolean) => {
  const b = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  return le ? b.reverse() : b;
};

function segment(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
}

const JFIF = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const SOS = [...segment(0xda, [1, 1, 0, 0, 0x3f, 0]), 0x12, 0x34, 0xff, 0xd9];

function exif(orientation: number | null, le: boolean): number[] {
  const entries: number[][] = [[...u16(0x0100, le), ...u16(3, le), ...u32(1, le), ...u16(4032, le), 0, 0]];
  if (orientation !== null) {
    entries.push([...u16(0x0112, le), ...u16(3, le), ...u32(1, le), ...u16(orientation, le), 0, 0]);
  }
  const tiff = [
    ...(le ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42, le),
    ...u32(8, le),
    ...u16(entries.length, le),
    ...entries.flat(),
    ...u32(0, le),
  ];
  return segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);
}

function jpeg(...parts: number[][]): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...parts.flat()]);
}

// ---------------------------------------------------------------------------------------------

describe('fitLongEdge', () => {
  it('scales the long edge down and keeps aspect', () => {
    expect(fitLongEdge({ width: 8160, height: 6120 }, ORIGINAL_TARGET_LONG_EDGE)).toEqual({ width: 4032, height: 3024 });
    expect(fitLongEdge({ width: 4032, height: 3024 }, DISPLAY_LONG_EDGE)).toEqual({ width: 2048, height: 1536 });
    expect(fitLongEdge({ width: 3024, height: 4032 }, DISPLAY_LONG_EDGE)).toEqual({ width: 1536, height: 2048 });
    expect(fitLongEdge({ width: 2048, height: 1536 }, THUMB_LONG_EDGE)).toEqual({ width: 384, height: 288 });
  });

  it('rounds non-integral edges', () => {
    expect(fitLongEdge({ width: 4000, height: 2250 }, 2048)).toEqual({ width: 2048, height: 1152 });
    expect(fitLongEdge({ width: 4001, height: 3001 }, 384)).toEqual({ width: 384, height: 288 });
  });

  it('never upscales and never returns a zero edge', () => {
    expect(fitLongEdge({ width: 1200, height: 900 }, 2048)).toEqual({ width: 1200, height: 900 });
    expect(fitLongEdge({ width: 10000, height: 10 }, 384)).toEqual({ width: 384, height: 1 });
  });

  it('sameSize compares both edges', () => {
    expect(sameSize({ width: 1, height: 2 }, { width: 1, height: 2 })).toBe(true);
    expect(sameSize({ width: 1, height: 2 }, { width: 2, height: 1 })).toBe(false);
  });
});

describe('isJpeg', () => {
  it('detects the SOI marker', () => {
    expect(isJpeg(jpeg(JFIF, SOS))).toBe(true);
    expect(isJpeg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isJpeg(new Uint8Array(0))).toBe(false);
  });
});

describe('jpegExifOrientation', () => {
  it('reads little-endian (Android) and big-endian EXIF', () => {
    expect(jpegExifOrientation(jpeg(exif(6, true), SOS))).toBe(6);
    expect(jpegExifOrientation(jpeg(exif(3, false), SOS))).toBe(3);
    expect(jpegExifOrientation(jpeg(JFIF, exif(1, true), SOS))).toBe(1);
  });

  it('returns null without EXIF or without the tag', () => {
    expect(jpegExifOrientation(jpeg(JFIF, SOS))).toBeNull();
    expect(jpegExifOrientation(jpeg(exif(null, true), SOS))).toBeNull();
  });

  it('skips fill bytes before a marker', () => {
    expect(jpegExifOrientation(jpeg([0xff], exif(8, true), SOS))).toBe(8);
  });

  it('does not look past the start of scan', () => {
    expect(jpegExifOrientation(jpeg(JFIF, SOS, exif(6, true)))).toBeNull();
  });

  it('survives truncated and invalid input', () => {
    const full = jpeg(exif(6, true), SOS);
    for (let cut = 0; cut < 40; cut++) {
      expect(() => jpegExifOrientation(full.subarray(0, cut))).not.toThrow();
    }
    expect(jpegExifOrientation(full.subarray(0, 30))).toBeNull();
    expect(jpegExifOrientation(jpeg(exif(9, true), SOS))).toBeNull();
    expect(jpegExifOrientation(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

describe('toHex', () => {
  it('encodes bytes as lower-case, zero-padded hex', () => {
    expect(toHex(Uint8Array.from([0, 1, 0xab, 0xff]))).toBe('0001abff');
    expect(toHex(Uint8Array.from([0xde, 0xad]).buffer)).toBe('dead');
    expect(toHex(new Uint8Array(0))).toBe('');
  });
});
