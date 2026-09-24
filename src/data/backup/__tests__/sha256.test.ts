/** @jest-environment node */
import { Sha256, sha256Bytes, sha256Utf8 } from '../sha256';

interface NodeCrypto {
  createHash(alg: 'sha256'): { update(data: Uint8Array): { digest(enc: 'hex'): string } };
  randomBytes(n: number): Uint8Array;
}
const nodeCrypto = () => jest.requireActual<NodeCrypto>('crypto');
const reference = (data: Uint8Array) => nodeCrypto().createHash('sha256').update(data).digest('hex');

describe('Sha256', () => {
  it('matches the FIPS 180-4 vectors', () => {
    expect(sha256Utf8('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Utf8('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes UTF-8, not UTF-16', () => {
    expect(sha256Utf8('Atlântico · 24 Sep')).toBe(reference(new TextEncoder().encode('Atlântico · 24 Sep')));
  });

  it('matches Node for every length around the padding boundaries', () => {
    const data = nodeCrypto().randomBytes(200);
    for (let n = 0; n <= 200; n++) expect(sha256Bytes(data.subarray(0, n))).toBe(reference(data.subarray(0, n)));
  });

  it('gives the same digest however the input is chunked', () => {
    const data = nodeCrypto().randomBytes(3 * 1024 * 1024 + 17);
    const expected = reference(data);
    for (const chunk of [1, 63, 64, 65, 4096, 1024 * 1024]) {
      const hash = new Sha256();
      // Uneven chunk sizes as well, like the last short read of a file handle.
      for (let offset = 0, i = 0; offset < data.length; i++) {
        const size = i % 2 === 0 ? chunk : chunk + 7;
        hash.update(data.subarray(offset, offset + size));
        offset += size;
      }
      expect(hash.digestHex()).toBe(expected);
    }
  });

  it('is final after digest', () => {
    const hash = new Sha256().update(new Uint8Array([1, 2, 3]));
    const first = hash.digestHex();
    expect(hash.digestHex()).toBe(first);
    expect(() => hash.update(new Uint8Array([4]))).toThrow();
  });
});
