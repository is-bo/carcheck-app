/// <reference types="node" />
/**
 * Guards a crash that only happens on the phone (return comparison, 2026-09-25): a worklet whose
 * parameter default names an outside value, e.g. `maxZoom = MAX_ZOOM`. The worklets Babel plugin
 * compiles it for the UI thread as
 *   function f(a, maxZoom = MAX_ZOOM) { const { MAX_ZOOM } = this.__closure; ... }
 * so the default runs before MAX_ZOOM is unpacked: ReferenceError on the UI thread, and Android
 * closes the app. Jest runs worklets as plain JS, so no behaviour test can see it; this compiles
 * every worklet with the real plugin and checks the generated code instead.
 */
import { transformFileSync } from '@babel/core';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const workletFiles = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'app'))].filter((f) =>
  readFileSync(f, 'utf8').includes("'worklet'"),
);

/** Each compiled worklet as [name, parameter list, captured names]. */
function compiledWorklets(file: string): [string, string, string[]][] {
  const out = transformFileSync(file, {
    babelrc: false,
    configFile: false,
    presets: [[require.resolve('@babel/preset-typescript'), { isTSX: true, allExtensions: true }]],
    plugins: [require.resolve('react-native-worklets/plugin')],
  });
  const code = out?.code ?? '';
  const found: [string, string, string[]][] = [];
  const re = /code: "function (\w+)\(([^)]*)\)\{(?:const\{([^}]*)\}=this\.__closure;)?/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    found.push([m[1], m[2], m[3] ? m[3].split(',').map((s) => s.split(':').pop()!.trim()) : []]);
  }
  return found;
}

describe('worklet parameter defaults', () => {
  it('finds the worklets to check', () => {
    expect(workletFiles.some((f) => f.endsWith(join('media', 'geometry.ts')))).toBe(true);
  });

  it.each(workletFiles.map((f) => [f.slice(ROOT.length + 1)]))('%s: no default reads a captured value', (rel) => {
    const offenders = compiledWorklets(join(ROOT, rel)).flatMap(([name, params, captured]) =>
      captured.filter((v) => new RegExp(`=[^,]*\\b${v}\\b`).test(params)).map((v) => `${name}: ${v}`),
    );
    expect(offenders).toEqual([]);
  });
});
