/**
 * Print stylesheet shared by every PDF: A4, 16 mm margins, Barlow, 0.5 pt rules, no fills.
 *
 * The running header/footer (agency, reference, generated time, "Page n of m") uses CSS @page
 * margin boxes. Android System WebView renders them from Chromium 131; older WebViews and iOS
 * simply omit them, and every document also carries the same facts in its body.
 */
import { palette, print } from '@/ui/theme/tokens';

import { cssString } from './escape';
import { CODE_FONT_STACK, FONT_STACK } from './fonts';

/** A4 in CSS px at 72 dpi, as expected by expo-print's width/height options. */
export const A4_WIDTH_PT = 595;
export const A4_HEIGHT_PT = 842;
export const PAGE_MARGIN_MM = print.marginMm;
/** Printable width and height inside the margins (bottom margin is 2 mm deeper for the footer). */
export const CONTENT_WIDTH_MM = 210 - 2 * PAGE_MARGIN_MM;
export const CONTENT_HEIGHT_MM = 297 - 2 * PAGE_MARGIN_MM - 2;

export interface PageChrome {
  headerLeft: string;
  headerRight: string;
  footerLeft: string;
}

const c = {
  ink: palette.ink,
  ink2: palette.ink2,
  ink3: palette.ink3,
  rule: palette.rule,
  outline: palette.outline,
  grey: palette.paper2,
};

function pageRules(chrome: PageChrome | null): string {
  const m = PAGE_MARGIN_MM;
  const box = `font-family:${FONT_STACK};font-size:${print.smallPt}pt;color:${c.ink3};`;
  const boxes = chrome
    ? `
  @top-left{content:${cssString(chrome.headerLeft)};${box}vertical-align:bottom;padding-bottom:4mm;}
  @top-right{content:${cssString(chrome.headerRight)};${box}vertical-align:bottom;padding-bottom:4mm;}
  @bottom-left{content:${cssString(chrome.footerLeft)};${box}vertical-align:top;padding-top:4mm;}
  @bottom-right{content:"Page " counter(page) " of " counter(pages);${box}vertical-align:top;padding-top:4mm;}`
    : '';
  return `@page{size:A4;margin:${m}mm ${m}mm ${m + 2}mm ${m}mm;${boxes}\n}`;
}

const BASE_CSS = `
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;-webkit-text-size-adjust:100%;}
*{box-sizing:border-box;}
body{margin:0;font-family:${FONT_STACK};font-size:${print.bodyPt}pt;line-height:${print.bodyLeadingPt}pt;color:${c.ink};background:#fff;}
h1,h2,h3,p,ul,ol,table,figure{margin:0;}
h1{font-size:${print.h1Pt}pt;line-height:${print.h1Pt + 4}pt;font-weight:600;letter-spacing:-0.1pt;}
h2{font-size:${print.h2Pt}pt;line-height:${print.h2Pt + 4}pt;font-weight:600;}
h3{font-size:11pt;line-height:15pt;font-weight:600;}
h1,h2,h3{break-after:avoid;page-break-after:avoid;}
strong,b{font-weight:600;}
img{display:block;}
.num,.plate,.code,td,th{font-feature-settings:"tnum" 1,"zero" 1;}
.muted{color:${c.ink2};}
.small{font-size:${print.smallPt}pt;line-height:${print.smallPt + 3.5}pt;}
.page-break{break-before:page;page-break-before:always;}
.keep{break-inside:avoid;page-break-inside:avoid;}

.section{margin-top:18pt;}
.section-title{display:flex;align-items:baseline;justify-content:space-between;gap:8pt;padding-bottom:3pt;margin-bottom:8pt;border-bottom:${print.rulePt}pt solid ${c.outline};break-after:avoid;page-break-after:avoid;}
.section-title .aside{font-size:${print.smallPt + 0.5}pt;color:${c.ink2};white-space:nowrap;}

.masthead{display:flex;align-items:flex-start;justify-content:space-between;gap:10mm;padding-bottom:5mm;border-bottom:1.5pt solid ${c.ink};}
.masthead-agency{display:flex;align-items:center;gap:4mm;min-width:0;}
.masthead-logo{max-height:16mm;max-width:40mm;width:auto;height:auto;}
.masthead-name{font-size:13pt;line-height:17pt;font-weight:600;}
.masthead-contact{font-size:${print.smallPt}pt;line-height:${print.smallPt + 3.5}pt;color:${c.ink2};}
.masthead-doc{text-align:right;white-space:nowrap;}
.masthead-doc .title{font-size:${print.smallPt + 1}pt;color:${c.ink2};}
.masthead-doc .ref{font-size:13pt;line-height:17pt;font-weight:600;font-feature-settings:"tnum" 1,"zero" 1;}

.cover-title{margin-top:7mm;}
.cover-title h1{display:flex;align-items:center;flex-wrap:wrap;gap:4mm;}
.cover-sub{margin-top:2pt;color:${c.ink2};}
.plate{display:inline-block;border:1.2pt solid ${c.ink};border-radius:2pt;padding:0.5pt 4pt 0;font-weight:600;letter-spacing:0.05em;line-height:1.15;background:#fff;white-space:nowrap;}
.plate.lg{font-size:13pt;padding:1pt 5pt 0;}

.columns{display:flex;gap:8mm;}
.columns>*{flex:1 1 0;min-width:0;}

table{border-collapse:collapse;width:100%;}
.kv th,.kv td{text-align:left;vertical-align:top;padding:3pt 0;border-bottom:${print.rulePt}pt solid ${c.rule};}
.kv th{font-weight:400;color:${c.ink2};width:38%;padding-right:8pt;}
.kv td{font-weight:400;}
.kv tr{break-inside:avoid;page-break-inside:avoid;}

.grid th,.grid td{text-align:left;vertical-align:top;padding:4pt 8pt 4pt 0;border-bottom:${print.rulePt}pt solid ${c.rule};}
.grid thead th{font-weight:600;font-size:${print.smallPt + 0.5}pt;color:${c.ink2};border-bottom:${print.rulePt}pt solid ${c.outline};}
.grid tr{break-inside:avoid;page-break-inside:avoid;}
.grid td.mark{white-space:nowrap;font-weight:600;}
.grid .note{color:${c.ink2};}

.glyph{display:inline-block;vertical-align:-2.5pt;width:12pt;height:12pt;margin-right:3pt;}
.status-line{display:flex;flex-wrap:wrap;gap:4pt 14pt;margin-top:6pt;}
.status-line span{white-space:nowrap;}
.statement{margin-top:8pt;font-size:12pt;line-height:17pt;font-weight:600;}

.evidence .section-title{margin-bottom:5mm;}
.evidence-img{margin:0 auto;border:${print.rulePt}pt solid ${c.rule};}
.captions{list-style:none;padding:0;margin-top:5mm;}
.captions li{padding:3pt 0;border-bottom:${print.rulePt}pt solid ${c.rule};break-inside:avoid;page-break-inside:avoid;}
.captions .detail{color:${c.ink2};}
.captions .note{display:block;margin-left:15pt;color:${c.ink2};}
.closeups{margin-top:4mm;font-size:0;}
.closeups figure{display:inline-block;vertical-align:top;width:31%;margin-right:3.5%;font-size:${print.smallPt}pt;}
.closeups figure:nth-child(3n){margin-right:0;}
.closeups img{width:100%;height:auto;border-radius:1pt;}

.sheet{font-size:0;line-height:0;}
.tile{display:inline-block;vertical-align:top;width:23.5%;margin:0 2% 4mm 0;break-inside:avoid;page-break-inside:avoid;}
.tile:nth-child(4n){margin-right:0;}
.tile-frame{position:relative;width:100%;padding-top:75%;background:${c.grey};border-radius:1pt;overflow:hidden;}
.tile-frame img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;}
.tile-frame .skip{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;font-size:${print.smallPt}pt;line-height:${print.smallPt + 3}pt;color:${c.ink2};background:repeating-linear-gradient(135deg,${c.grey} 0 4pt,#fff 4pt 6pt);}
.code{display:block;margin-top:2pt;font-family:${CODE_FONT_STACK};font-weight:500;font-size:7pt;line-height:9pt;letter-spacing:0.06em;text-transform:uppercase;color:${c.ink2};}

.signature{width:80mm;margin-top:8mm;break-inside:avoid;page-break-inside:avoid;}
.signature img{height:22mm;width:auto;max-width:80mm;}
.signature .missing{height:22mm;display:flex;align-items:flex-end;color:${c.ink3};font-size:${print.smallPt}pt;}
.signature .line{border-top:1pt solid ${c.ink};margin-top:1mm;}
.signature .name{margin-top:2pt;font-weight:600;}
.signature .when{font-size:${print.smallPt}pt;line-height:${print.smallPt + 3.5}pt;color:${c.ink2};}
.signatures{font-size:0;}
.signatures .signature{display:inline-block;vertical-align:top;margin-right:8mm;font-size:${print.bodyPt}pt;}
.signature .state{font-size:${print.smallPt}pt;font-weight:600;letter-spacing:0.02em;}

.integrity{margin-top:10mm;padding-top:3mm;border-top:${print.rulePt}pt solid ${c.outline};break-inside:avoid;page-break-inside:avoid;}
.integrity h3{margin-bottom:3pt;}
.integrity .kv th{width:30%;}
.integrity .hash{font-family:${CODE_FONT_STACK};font-weight:500;letter-spacing:0.04em;}
.integrity p{margin-top:4pt;}

.contract-wrap{position:relative;}
.void-banner{margin-bottom:6mm;padding:3mm 0;border-top:1.5pt solid ${c.ink};border-bottom:1.5pt solid ${c.ink};font-weight:600;}
.void-banner .muted{font-weight:400;}
.void-mark{position:absolute;left:0;right:0;top:70mm;text-align:center;font-size:110pt;line-height:1;font-weight:600;letter-spacing:8pt;color:rgba(138,145,150,0.28);transform:rotate(-32deg);pointer-events:none;z-index:1;}
.void-mark.fixed{position:fixed;top:95mm;}

.contract{font-size:${print.bodyPt}pt;line-height:${print.bodyLeadingPt}pt;}
.contract h1{font-size:16pt;line-height:20pt;margin:0 0 6pt;}
.contract h2{font-size:12pt;line-height:16pt;margin:12pt 0 4pt;}
.contract h3{font-size:11pt;line-height:15pt;margin:10pt 0 3pt;}
.contract p{margin:0 0 6pt;}
.contract ul,.contract ol{margin:0 0 6pt;padding-left:14pt;}
.contract li{margin:0 0 2pt;}
.contract img{max-width:100%;height:auto;}
.contract svg{max-width:100%;height:auto;}
.contract table{margin:0 0 6pt;}
.contract td,.contract th{border-bottom:${print.rulePt}pt solid ${c.rule};padding:3pt 8pt 3pt 0;text-align:left;vertical-align:top;}

.footer-note{margin-top:12mm;font-size:${print.smallPt}pt;line-height:${print.smallPt + 3.5}pt;color:${c.ink2};}
`;

/** Full stylesheet for one document: fonts, @page rules, then the shared component styles. */
export function printStylesheet(chrome: PageChrome | null, fontCss: string): string {
  return [fontCss, pageRules(chrome), BASE_CSS].join('\n');
}
