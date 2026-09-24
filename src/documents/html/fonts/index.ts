/**
 * Barlow as base64 @font-face rules, so PDFs render in the brand face with no network.
 * Three faces cover the print system: 400 body, 600 headings/strong (also matched for bold
 * without synthesis), Semi Condensed 500 for edge codes.
 */
import { BARLOW_400, BARLOW_600, BARLOW_SEMI_CONDENSED_500 } from './fontData.generated';

export const FONT_STACK = 'Barlow, "Helvetica Neue", Arial, sans-serif';
export const CODE_FONT_STACK = '"Barlow Semi Condensed", Barlow, "Arial Narrow", sans-serif';

function face(family: string, weight: number, base64: string): string {
  return (
    `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};` +
    `src:url(data:font/ttf;base64,${base64}) format("truetype");}`
  );
}

let cached: string | null = null;

export function fontFaceCss(): string {
  cached ??= [
    face('Barlow', 400, BARLOW_400),
    face('Barlow', 600, BARLOW_600),
    face('Barlow Semi Condensed', 500, BARLOW_SEMI_CONDENSED_500),
  ].join('\n');
  return cached;
}
