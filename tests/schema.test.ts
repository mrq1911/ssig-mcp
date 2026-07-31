import { describe, expect, it } from 'vitest';
import { evmRequestInputSchema, solanaRequestInputSchema } from '../src/shared/schema.js';
import { asciiExplanation } from './fixtures.js';

describe('transaction input schemas', () => {
  it('accepts a strict EVM transaction with an ASCII explanation', () => {
    const input = evmRequestInputSchema.parse({
      chain: 'evm',
      title: 'Test transfer',
      asciiExplanation,
      mode: 'sign-and-submit',
      chainId: 1,
      expectedSigner: '0x2222222222222222222222222222222222222222',
      transaction: {
        to: '0x1111111111111111111111111111111111111111',
        value: '0x1',
      },
    });
    expect(input.transaction.data).toBe('0x');
    expect(input.expiresInMinutes).toBe(15);
  });

  it('rejects non-ASCII agent explanations', () => {
    const result = solanaRequestInputSchema.safeParse({
      chain: 'solana',
      title: 'Unicode explanation',
      asciiExplanation: `${asciiExplanation}\nRisk: irreversible -> ⚠`,
      mode: 'sign',
      network: 'solana:devnet',
      transactionBase64: 'AAAA',
    });
    expect(result.success).toBe(false);
  });

  it('rejects ambiguous EVM fee formats', () => {
    const result = evmRequestInputSchema.safeParse({
      chain: 'evm',
      title: 'Bad fee transaction',
      asciiExplanation,
      mode: 'sign-and-submit',
      chainId: 1,
      transaction: {
        to: '0x1111111111111111111111111111111111111111',
        gasPrice: '0x1',
        maxFeePerGas: '0x2',
      },
    });
    expect(result.success).toBe(false);
  });
});
