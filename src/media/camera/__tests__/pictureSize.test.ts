import {
  IOS_PHOTO_PRESET,
  isFourThree,
  MAX_CAPTURE_LONG_EDGE,
  parsePictureSize,
  selectPictureSize,
} from '../pictureSize';

describe('parsePictureSize', () => {
  it('parses Android WxH strings', () => {
    expect(parsePictureSize('4032x3024')).toEqual({ width: 4032, height: 3024 });
    expect(parsePictureSize(' 640x480 ')).toEqual({ width: 640, height: 480 });
  });

  it('rejects presets and malformed values', () => {
    expect(parsePictureSize('Photo')).toBeNull();
    expect(parsePictureSize('4032*3024')).toBeNull();
    expect(parsePictureSize('0x480')).toBeNull();
    expect(parsePictureSize('')).toBeNull();
  });
});

describe('isFourThree', () => {
  it('accepts 4:3 in either orientation and near-4:3 sensor sizes', () => {
    expect(isFourThree({ width: 4032, height: 3024 })).toBe(true);
    expect(isFourThree({ width: 3024, height: 4032 })).toBe(true);
    expect(isFourThree({ width: 4000, height: 3000 })).toBe(true);
    expect(isFourThree({ width: 4080, height: 3072 })).toBe(true); // 1.328
  });

  it('rejects 16:9 and square', () => {
    expect(isFourThree({ width: 3840, height: 2160 })).toBe(false);
    expect(isFourThree({ width: 3000, height: 3000 })).toBe(false);
  });
});

describe('selectPictureSize', () => {
  it('picks the largest 4:3 size within the long-edge cap (typical 50 MP phone)', () => {
    const sizes = ['8160x6120', '4080x3060', '4032x3024', '3840x2160', '4000x2250', '1920x1440', '640x480'];
    expect(selectPictureSize(sizes)).toBe('4080x3060');
    expect(selectPictureSize(sizes, 4050)).toBe('4032x3024');
  });

  it('never returns a size above the cap when a good one exists', () => {
    const chosen = selectPictureSize(['12000x9000', '4000x3000', '3264x2448']);
    expect(chosen).toBe('4000x3000');
    const long = Math.max(...chosen!.split('x').map(Number));
    expect(long).toBeLessThanOrEqual(MAX_CAPTURE_LONG_EDGE);
  });

  it('prefers the smallest larger 4:3 size over a small native one', () => {
    expect(selectPictureSize(['8000x6000', '6000x4500', '1600x1200'])).toBe('6000x4500');
  });

  it('keeps a small 4:3 size when nothing larger exists', () => {
    expect(selectPictureSize(['1600x1200', '1920x1080'])).toBe('1600x1200');
  });

  it('falls back to the iOS Photo preset, then to the camera default', () => {
    expect(selectPictureSize(['3840x2160', '1920x1080', 'Photo', 'High'])).toBe(IOS_PHOTO_PRESET);
    expect(selectPictureSize(['3840x2160', '1920x1080'])).toBeUndefined();
    expect(selectPictureSize([])).toBeUndefined();
  });
});
