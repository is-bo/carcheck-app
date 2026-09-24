import {
  applyContractAssets,
  buildContractPdfHtml,
  listContractRefs,
  resolveContract,
  SIGNATURE_TOKEN,
  splitFrozenHtml,
  type ContractRef,
} from '../contract';
import { contract, FROZEN_HTML, JPEG, PNG } from './fixtures';

const docInput = (p = {}) => ({ ...contract(p), reference: 'R-0142', agencyName: 'Coastline' });

describe('contract references', () => {
  it('lists unique photo/signature attribute references in order, ignoring plain text', () => {
    const html = `${FROZEN_HTML}<img src='carcheck-photo:p-1'><img src="${SIGNATURE_TOKEN}">`;
    expect(listContractRefs(html)).toEqual([
      { kind: 'photo', token: 'carcheck-photo:p-1', photoId: 'p-1' },
      { kind: 'photo', token: 'carcheck-photo:p-2', photoId: 'p-2' },
      { kind: 'signature', token: SIGNATURE_TOKEN },
    ]);
  });

  it('changes nothing but the reference attribute values (frozen content preserved)', () => {
    const out = applyContractAssets(FROZEN_HTML, { 'carcheck-photo:p-1': JPEG, 'carcheck-photo:p-2': JPEG });
    expect(out).not.toContain('src="carcheck-photo:');
    expect(out).not.toContain('href="carcheck-photo:');
    expect(out).toContain('carcheck-photo:p-9 stays text');
    // Putting the tokens back must give the exact signed bytes.
    const restored = out
      .replace(`src="${JPEG}"`, 'src="carcheck-photo:p-1"')
      .replace(`href="${JPEG}"`, 'href="carcheck-photo:p-2"');
    expect(restored).toBe(FROZEN_HTML);
  });

  it('prints a visible placeholder for unavailable or unsafe assets', () => {
    const out = applyContractAssets('<img src="carcheck-photo:x"><img src="carcheck-signature:customer">', {
      'carcheck-photo:x': 'file:///secret.jpg',
    });
    expect(out).not.toContain('file://');
    expect(decodeURIComponent(out)).toContain('Photo unavailable');
    expect(decodeURIComponent(out)).toContain('Signature unavailable');
  });

  it('keeps styles and body of a full document verbatim', () => {
    const doc = '<html><head><style>.contract p{color:red}</style><title>x</title></head><body class="b"><p>Hi</p></body></html>';
    expect(splitFrozenHtml(doc)).toEqual({ styles: '<style>.contract p{color:red}</style>', body: '<p>Hi</p>' });
    expect(splitFrozenHtml('<p>Fragment</p>')).toEqual({ styles: '', body: '<p>Fragment</p>' });
  });
});

describe('resolveContract', () => {
  it('resolves sequentially, once per token, and survives resolver failures', async () => {
    const calls: string[] = [];
    let inFlight = 0;
    const resolver = async (ref: ContractRef) => {
      inFlight++;
      expect(inFlight).toBe(1);
      calls.push(ref.token);
      await Promise.resolve();
      inFlight--;
      if (ref.kind === 'photo' && ref.photoId === 'p-2') throw new Error('gone');
      return ref.kind === 'signature' ? PNG : JPEG;
    };
    const { assets } = await resolveContract(contract(), resolver);
    expect(calls).toEqual(['carcheck-photo:p-1', 'carcheck-photo:p-2', SIGNATURE_TOKEN]);
    expect(assets).toEqual({ 'carcheck-photo:p-1': JPEG, 'carcheck-photo:p-2': null, [SIGNATURE_TOKEN]: PNG });
  });

  it('resolves only the signature when asked', async () => {
    const resolver = jest.fn(() => PNG);
    const { assets } = await resolveContract(contract(), resolver, { signatureOnly: true });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(assets).toEqual({ [SIGNATURE_TOKEN]: PNG });
  });
});

describe('buildContractPdfHtml', () => {
  const resolver = (ref: ContractRef) => (ref.kind === 'signature' ? PNG : JPEG);

  it('embeds the frozen HTML, appends the signature and the integrity record', async () => {
    const html = await buildContractPdfHtml(docInput(), resolver, { embedFonts: false });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<h1>Rental agreement</h1>\n<p>I, <strong>Jane &quot;JJ&quot; Smith</strong>, accept the vehicle.</p>');
    expect(html).toContain(`src="${PNG}"`);
    expect(html).toContain('Signed 24 Sep 2026, 17:05:32 (UTC+02:00)');
    expect(html).toContain('3f9a 1c2b 77d0 e41d');
    expect(html).toContain('R-0142');
    expect(html).toContain('Jane &quot;JJ&quot; Smith');
    expect(html).toContain('@page{size:A4;');
    expect(html).toContain('counter(pages)');
    expect(html).not.toContain('VOID');
    expect(html).not.toContain('@font-face');
  });

  it('does not add a second signature when the template placed it', async () => {
    const html = await buildContractPdfHtml(
      docInput({ renderedHtml: `<p>Signed:</p><img src="${SIGNATURE_TOKEN}">` }),
      resolver,
      { embedFonts: false },
    );
    expect(html.split(`src="${PNG}"`)).toHaveLength(2);
    expect(html).not.toContain('class="signature"');
  });

  it('marks a voided contract and keeps it legible', async () => {
    const html = await buildContractPdfHtml(
      docInput({ void: { contractId: 'c-1', voidedAt: Date.UTC(2026, 8, 25, 8, 0), reason: 'Wrong <date>', createdAt: 0 } }),
      resolver,
      { embedFonts: false },
    );
    expect(html).toContain('class="void-mark fixed"');
    expect(html).toContain('Voided on 25 Sep 2026, 10:00');
    expect(html).toContain('Wrong &lt;date&gt;');
    expect(html).toContain('<h1>Rental agreement</h1>');
  });

  it('embeds Barlow by default', async () => {
    const html = await buildContractPdfHtml(docInput(), resolver);
    expect(html).toMatch(/@font-face\{font-family:"Barlow";font-style:normal;font-weight:400;src:url\(data:font\/ttf;base64,/);
    expect(html).toContain('font-family:"Barlow Semi Condensed"');
  });
});
