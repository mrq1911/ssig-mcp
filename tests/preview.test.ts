import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import { decodeSolanaWire } from '../src/web/preview.js';

describe('Solana wire preview', () => {
  it('decodes a bounded legacy transaction without executing it', () => {
    const bytes = new Uint8Array(170);
    let offset = 0;
    bytes[offset++] = 1; // signature count
    offset += 64;
    bytes[offset++] = 1; // required signatures
    bytes[offset++] = 0; // readonly signed
    bytes[offset++] = 1; // readonly unsigned
    bytes[offset++] = 2; // static account count
    bytes.fill(1, offset, offset + 32);
    offset += 32;
    bytes.fill(2, offset, offset + 32);
    offset += 32;
    bytes.fill(3, offset, offset + 32);
    offset += 32;
    bytes[offset++] = 1; // instruction count
    bytes[offset++] = 1; // program id index
    bytes[offset++] = 1; // account index count
    bytes[offset++] = 0; // signer account
    bytes[offset++] = 0; // instruction data length

    const decoded = decodeSolanaWire(bytes) as {
      version: string;
      signatureCount: number;
      staticAccounts: string[];
      instructions: unknown[];
    };
    expect(offset).toBe(bytes.length);
    expect(decoded.version).toBe('legacy');
    expect(decoded.signatureCount).toBe(1);
    expect(decoded.staticAccounts).toHaveLength(2);
    expect(decoded.staticAccounts[0]).toBe(bs58.encode(new Uint8Array(32).fill(1)));
    expect(decoded.instructions).toHaveLength(1);
  });

  it('rejects truncated transaction vectors', () => {
    expect(() => decodeSolanaWire(new Uint8Array([1, 0, 0]))).toThrow(
      /Unexpected end|Invalid length/,
    );
  });
});
