import { contractHtmlToBlocks } from '@/documents/contractBlocks';

import {
  CONTRACT_VARIABLES,
  contractHtmlReferences,
  inspectContractTemplate,
  isStarterTemplate,
  renderContractTemplate,
  sampleRentalContext,
  STARTER_TEMPLATE_BODY,
  type RentalContext,
} from '..';

function ctx(overrides: Partial<RentalContext> = {}): RentalContext {
  return { ...sampleRentalContext(), ...overrides };
}

describe('renderContractTemplate', () => {
  it('renders headings, paragraphs with line breaks, bold and lists', () => {
    const body = '# Title\n## Sub\n\nFirst **bold** line\nsecond line\n\n- one\n- **two**\n\n1. first\n2) second';
    expect(renderContractTemplate(body, ctx()).html).toBe(
      [
        '<h1>Title</h1>',
        '<h2>Sub</h2>',
        '<p>First <strong>bold</strong> line<br>second line</p>',
        '<ul><li>one</li><li><strong>two</strong></li></ul>',
        '<ol><li>first</li><li>second</li></ol>',
      ].join('\n'),
    );
  });

  it('escapes template text and variable values', () => {
    const context = ctx({ customer: { ...sampleRentalContext().customer, fullName: '<img src=x onerror=alert(1)> & "Co"' } });
    const { html } = renderContractTemplate('<b>Hi</b> {{customer.name}}', context);
    expect(html).toBe('<p>&lt;b&gt;Hi&lt;/b&gt; &lt;img src=x onerror=alert(1)&gt; &amp; &quot;Co&quot;</p>');
    expect(contractHtmlReferences(html).invalid).toEqual([]);
  });

  it('shows unknown variables visibly and reports them; empty values print a dash', () => {
    const context = ctx({ vehicle: { ...sampleRentalContext().vehicle!, vin: null } });
    const result = renderContractTemplate('VIN: {{ vehicle.vin }} / {{customer.shoe_size}} / {{Customer.Name}}', context);
    expect(result.html).toBe('<p>VIN: — / [missing: customer.shoe_size] / Jane Smith</p>');
    expect(result.unknownKeys).toEqual(['customer.shoe_size']);
    expect(result.emptyKeys).toEqual(['vehicle.vin']);
    expect(result.usedKeys).toEqual(['vehicle.vin', 'customer.shoe_size', 'customer.name']);
    expect(result.blocks[0]).toEqual({
      type: 'paragraph',
      lines: [
        [
          { kind: 'text', text: 'VIN: ', bold: false },
          { kind: 'variable', key: 'vehicle.vin', value: null, known: true, bold: false },
          { kind: 'text', text: ' / ', bold: false },
          { kind: 'variable', key: 'customer.shoe_size', value: null, known: false, bold: false },
          { kind: 'text', text: ' / ', bold: false },
          { kind: 'variable', key: 'customer.name', value: 'Jane Smith', known: true, bold: false },
        ],
      ],
    });
  });

  it('keeps an unpaired ** literal and lets bold wrap variables', () => {
    expect(renderContractTemplate('**{{customer.name}}** costs 2**3', ctx()).html).toBe('<p><strong>Jane Smith</strong> costs 2**3</p>');
  });

  it('renders the existing-damage block with only carcheck-photo references and inlined markers', () => {
    const { html, blocks } = renderContractTemplate('{{damage.existing_list}}', ctx());
    expect(blocks).toEqual([{ type: 'variable', key: 'damage.existing_list' }]);
    const refs = contractHtmlReferences(html);
    expect(refs).toEqual({ photoIds: ['sample-front-left', 'sample-right'], signature: false, invalid: [] });
    expect(html).toContain('<image href="carcheck-photo:sample-front-left"');
    expect(html).toContain('>A</text>');
    expect(html).toContain('<li>B — Dent, rear door · Moderate · “Small dent below the handle”</li>');
    const inline = renderContractTemplate('Known: {{damage.existing_list}}', ctx({ existingDamage: [] })).html;
    expect(inline).toBe('<p>Known: No existing damage recorded</p>');
  });

  it('emits only the tag subset the documents module parses', () => {
    const { html } = renderContractTemplate(STARTER_TEMPLATE_BODY, ctx());
    const tags = new Set([...html.matchAll(/<([a-z0-9]+)[\s>/]/g)].map((m) => m[1]));
    const allowed = new Set(['h1', 'h2', 'h3', 'p', 'ul', 'ol', 'li', 'strong', 'br', 'img', 'svg', 'image', 'circle', 'rect', 'text']);
    expect([...tags].filter((t) => !allowed.has(t))).toEqual([]);
    const refs = contractHtmlReferences(html);
    expect(refs.signature).toBe(true);
    expect(refs.invalid).toEqual([]);

    const blocks = contractHtmlToBlocks(html);
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, spans: [{ text: 'Vehicle condition agreement' }] });
    expect(blocks.filter((b) => b.type === 'image').map((b) => b.type === 'image' && b.source)).toEqual([
      { kind: 'photo', photoId: 'sample-front-left', annotated: true },
      { kind: 'photo', photoId: 'sample-right', annotated: true },
    ]);
    expect(blocks.some((b) => b.type === 'signature')).toBe(true);
  });
});

describe('starter template and registry', () => {
  it('uses only registered variables and is recognised as the starter text', () => {
    expect(inspectContractTemplate(STARTER_TEMPLATE_BODY).unknownKeys).toEqual([]);
    expect(isStarterTemplate(`${STARTER_TEMPLATE_BODY}\r\n`)).toBe(true);
    expect(isStarterTemplate(`${STARTER_TEMPLATE_BODY} edited`)).toBe(false);
  });

  it('resolves every registered variable into the snapshot, with unique keys', () => {
    const keys = CONTRACT_VARIABLES.map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);
    const { variables } = renderContractTemplate('', ctx());
    expect(Object.keys(variables).sort()).toEqual([...keys].sort());
    expect(variables['rental.start']).toBe('12 Mar 2026, 09:14');
    expect(variables['rental.start_mileage']).toBe('48 210 km');
    expect(variables['rental.fuel']).toBe('¾');
    expect(variables['damage.existing_count']).toBe('2');
  });
});
