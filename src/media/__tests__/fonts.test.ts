/// <reference types="node" />
/**
 * makeSkiaFont must call SkFont setters with the argument kinds the installed native code reads.
 * RN Skia's C++ (JsiSkFont.h) reads some "boolean" setters with asNumber(): a JS `true` there
 * throws on the device ("Value is true, expected a number"), which blanked the comparison
 * markers and would fail evidence captions. Jest has no native Skia, so the fake font below
 * enforces what the installed JsiSkFont.h actually does.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const header = readFileSync(
  join(__dirname, '..', '..', '..', 'node_modules', '@shopify', 'react-native-skia', 'cpp', 'api', 'JsiSkFont.h'),
  'utf8',
);

/** setter name -> 'number' | 'bool', from `JSI_HOST_FUNCTION(setX) { auto v = arguments[0].asNumber()/getBool()`. */
function nativeArgKinds(): Record<string, 'number' | 'bool'> {
  const kinds: Record<string, 'number' | 'bool'> = {};
  const re = /JSI_HOST_FUNCTION\((set\w+)\)\s*\{[^}]*?arguments\[0\]\.(asNumber|getBool)\(\)/g;
  for (let m = re.exec(header); m; m = re.exec(header)) kinds[m[1]] = m[2] === 'asNumber' ? 'number' : 'bool';
  return kinds;
}

const kinds = nativeArgKinds();

function strictFont() {
  const calls: string[] = [];
  const font: Record<string, (v: unknown) => void> = {};
  for (const [name, kind] of Object.entries(kinds)) {
    font[name] = (v: unknown) => {
      if (kind === 'number' && typeof v !== 'number') throw new Error(`Value is ${String(v)}, expected a number`);
      if (kind === 'bool' && typeof v !== 'boolean') throw new Error(`Value is ${String(v)}, expected a boolean`);
      calls.push(name);
    };
  }
  return { font, calls };
}

let mockCurrent: ReturnType<typeof strictFont>;
jest.mock('@shopify/react-native-skia', () => ({
  FontEdging: { AntiAlias: 1 },
  FontHinting: { None: 0 },
  Skia: { Font: () => mockCurrent.font },
  loadData: jest.fn(),
}));

// eslint-disable-next-line import/first
import { makeSkiaFont } from '../fonts';

describe('makeSkiaFont against the installed native SkFont', () => {
  it('reads the setter argument kinds from JsiSkFont.h', () => {
    expect(kinds.setSubpixel).toBeDefined();
    expect(kinds.setLinearMetrics).toBeDefined();
    expect(kinds.setEdging).toBe('number');
  });

  it('configures a font without a native type error', () => {
    mockCurrent = strictFont();
    expect(() => makeSkiaFont({} as never, 13)).not.toThrow();
    expect(mockCurrent.calls).toEqual(expect.arrayContaining(['setEdging', 'setHinting', 'setLinearMetrics', 'setSubpixel']));
  });
});
