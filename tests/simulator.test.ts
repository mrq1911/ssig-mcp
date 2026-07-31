import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/server/config.js';
import { simulateTransaction } from '../src/server/simulator.js';
import { evmRequestInputSchema, solanaRequestInputSchema } from '../src/shared/schema.js';
import { asciiExplanation } from './fixtures.js';

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataFile: '/tmp/unused-ssig-test.json',
    webDirectory: '/tmp',
    requestLimit: 100,
    requireSimulation: false,
    blockFailedSimulation: true,
    evmRpcUrls: {},
    solanaRpcUrls: {},
    suiGrpcUrls: {},
    ...overrides,
  };
}

describe('simulation providers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses Tenderly first for EVM requests', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          simulation: { id: 'sim-1' },
          transaction: { status: true, gas_used: 21_000 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await simulateTransaction(
      evmRequestInputSchema.parse({
        chain: 'evm',
        title: 'Tenderly simulation',
        asciiExplanation,
        mode: 'sign-and-submit',
        chainId: 1,
        expectedSigner: '0x2222222222222222222222222222222222222222',
        transaction: { to: '0x1111111111111111111111111111111111111111' },
      }),
      config({
        tenderly: { account: 'account', project: 'project', accessKey: 'secret' },
      }),
    );

    expect(result.status).toBe('success');
    expect(result.provider).toBe('tenderly');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/account/account/project/project/simulate');
  });

  it('interprets native Solana simulateTransaction failures', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { value: { err: { InstructionError: [0, 'Custom'] }, logs: [] } },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await simulateTransaction(
      solanaRequestInputSchema.parse({
        chain: 'solana',
        title: 'Solana simulation',
        asciiExplanation,
        mode: 'sign',
        network: 'solana:devnet',
        transactionBase64: 'AAAA',
      }),
      config({ solanaRpcUrls: { 'solana:devnet': 'https://solana.example/rpc' } }),
    );

    expect(result.status).toBe('failed');
    expect(result.provider).toBe('solana-rpc');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).toContain('simulateTransaction');
  });
});
