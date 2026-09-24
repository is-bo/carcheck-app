import { contractHtmlToBlocks, spansToText } from '../contractBlocks';
import { decodeEntities, parseHtml } from '../html/parse';
import { FROZEN_HTML } from './fixtures';

describe('parseHtml', () => {
  it('builds a tree, tolerating void, self-closing and unclosed elements', () => {
    const root = parseHtml('<p>a<br>b<p>c<img src="x"/><!-- note --></div>');
    expect(root.children.map((n) => (n.type === 'element' ? n.name : 'text'))).toEqual(['p', 'p']);
  });

  it('keeps raw text of style/script out of the markup', () => {
    const root = parseHtml('<style>p > b { x: "<p>" }</style><p>ok</p>');
    const style = root.children[0];
    expect(style.type === 'element' && style.children[0]).toEqual({ type: 'text', text: 'p > b { x: "<p>" }' });
  });

  it('decodes entities', () => {
    expect(decodeEntities('&amp;&lt;&#39;&#x20AC;&nbsp;&unknown;')).toBe("&<'€ &unknown;");
  });
});

describe('contractHtmlToBlocks', () => {
  it('maps the template subset to blocks with bold spans', () => {
    const blocks = contractHtmlToBlocks(
      '<h1>Rental   agreement</h1>\n<h2>Terms</h2>\n<p>The <strong>customer</strong> returns the car\n on <b>time</b>.</p>' +
        '<ul><li>One</li><li><strong>Two</strong> items<ul><li>Nested</li></ul></li></ul><ol><li>First</li></ol><hr>',
    );
    expect(blocks).toEqual([
      { type: 'heading', level: 1, spans: [{ text: 'Rental agreement' }] },
      { type: 'heading', level: 2, spans: [{ text: 'Terms' }] },
      {
        type: 'paragraph',
        spans: [
          { text: 'The ' },
          { text: 'customer', bold: true },
          { text: ' returns the car on ' },
          { text: 'time', bold: true },
          { text: '.' },
        ],
      },
      {
        type: 'list',
        ordered: false,
        items: [
          { spans: [{ text: 'One' }], depth: 0, images: [] },
          { spans: [{ text: 'Two', bold: true }, { text: ' items' }], depth: 0, images: [] },
          { spans: [{ text: 'Nested' }], depth: 1, images: [] },
        ],
      },
      { type: 'list', ordered: true, items: [{ spans: [{ text: 'First' }], depth: 0, images: [] }] },
      { type: 'rule' },
    ]);
  });

  it('keeps <br> as a line break and decodes entities', () => {
    const [block] = contractHtmlToBlocks('<p>Line 1 <br>\n Line &amp; 2</p>');
    expect(block).toEqual({ type: 'paragraph', spans: [{ text: 'Line 1\nLine & 2' }] });
  });

  it('finds photos (plain and annotated SVG) and the signature slot, never SVG text', () => {
    const blocks = contractHtmlToBlocks(`${FROZEN_HTML}<div class="sig"><img src="carcheck-signature:customer"><p>Jane</p></div>`);
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      spans: [{ text: 'I, ' }, { text: 'Jane "JJ" Smith', bold: true }, { text: ', accept the vehicle.' }],
    });
    expect(blocks[2]).toEqual({
      type: 'list',
      ordered: false,
      items: [{ spans: [{ text: 'Existing A · Scratch' }], depth: 0, images: [{ kind: 'photo', photoId: 'p-1', annotated: false }] }],
    });
    expect(blocks[3]).toEqual({ type: 'image', alt: 'Rear', source: { kind: 'photo', photoId: 'p-2', annotated: true } });
    expect(blocks.slice(4)).toEqual([
      { type: 'paragraph', spans: [{ text: 'Text mentioning carcheck-photo:p-9 stays text.' }] },
      { type: 'signature' },
      { type: 'paragraph', spans: [{ text: 'Jane' }] },
    ]);
  });

  it('walks unknown containers and tables without losing text; ignores head, style, script', () => {
    const blocks = contractHtmlToBlocks(
      '<html><head><title>T</title><style>p{}</style></head><body><section><div>Loose <em>text</em></div>' +
        '<table><tr><th>Plate</th><td>AB-1</td></tr><tr><td></td><td>x</td></tr></table><script>bad()</script></section></body></html>',
    );
    expect(blocks).toEqual([
      { type: 'paragraph', spans: [{ text: 'Loose ' }, { text: 'text', italic: true }] },
      { type: 'paragraph', spans: [{ text: 'Plate', bold: true }, { text: ' · AB-1' }] },
      { type: 'paragraph', spans: [{ text: 'x' }] },
    ]);
    expect(spansToText(blocks[1].type === 'paragraph' ? blocks[1].spans : [])).toBe('Plate · AB-1');
  });

  it('returns no blocks for empty or whitespace-only input', () => {
    expect(contractHtmlToBlocks('')).toEqual([]);
    expect(contractHtmlToBlocks('  <p> \n </p> <div></div>')).toEqual([]);
  });
});
