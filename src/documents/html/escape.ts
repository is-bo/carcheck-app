/** Escaping for the three contexts documents write user text into. */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Text content and double- or single-quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Escaped text with line breaks kept (notes, addresses). */
export function escapeMultiline(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, '<br>');
}

/** A CSS string literal (quotes included), e.g. for `content:` in @page margin boxes. */
export function cssString(value: string): string {
  const body = value.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\r\n\f]+/g, ' ');
  // "<" is escaped so the value can never close the surrounding <style> element.
  return `"${body.replace(/</g, '\\3C ')}"`;
}

/** Only data: URIs of images may become `src` values; anything else is dropped. */
export function safeImageSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^data:image\/(png|jpe?g|webp|gif|svg\+xml)[;,]/i.test(value) ? value : null;
}
