import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHash, sha256, sha256Bytes } from '../core/hash';

function nodeSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('sha256Bytes', () => {
  it('matches node:crypto across every padding-boundary length', () => {
    // Every residue class of len % 64 matters: the padding block count changes
    // at len % 64 == 55 (message + 0x80 + 8-byte length exactly fills a block),
    // which a previous off-by-one turned into an extra spurious zero block.
    for (let len = 0; len <= 200; len += 1) {
      const bytes = new Uint8Array(len).map((_, index) => (index * 31 + 7) & 0xff);
      expect(sha256Bytes(bytes), `length ${len}`).toBe(nodeSha256(bytes));
    }
  });

  it('matches node:crypto for the 375-byte disabled-traffic envelope shape', () => {
    // Regression: the disabled materialized-traffic artifact serialises to 375
    // bytes (375 % 64 == 55); the wrong digest made every checksum-bound S3
    // upload of it fail with 400 BadDigest.
    const bytes = new TextEncoder().encode('a'.repeat(375));
    expect(sha256Bytes(bytes)).toBe(nodeSha256(bytes));
  });

  it('agrees with the NIST empty-input and abc vectors', () => {
    expect(sha256Bytes(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('keeps contentHash equal to sha256 of the canonical JSON', () => {
    const value = { b: 1, a: [1, 2, { z: null }] };
    expect(contentHash(value)).toBe(
      nodeSha256(new TextEncoder().encode(canonicalJson(value))),
    );
  });
});
