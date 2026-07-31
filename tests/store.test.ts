import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evmRequestInputSchema, type Simulation } from '../src/shared/schema.js';
import { RequestStore } from '../src/server/store.js';
import { asciiExplanation } from './fixtures.js';

const simulation: Simulation = {
  status: 'unavailable',
  provider: 'none',
  performedAt: '2026-07-31T12:00:00.000Z',
  summary: 'No simulator configured',
};

describe('RequestStore', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'ssig-store-'));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(directory, { recursive: true, force: true });
  });

  it('persists, completes, and reloads a request', async () => {
    const file = path.join(directory, 'requests.json');
    const store = new RequestStore(file);
    await store.initialize();
    const input = evmRequestInputSchema.parse({
      chain: 'evm',
      title: 'Stored transaction',
      asciiExplanation,
      mode: 'sign-and-submit',
      chainId: 1,
      transaction: { to: '0x1111111111111111111111111111111111111111' },
    });
    const created = await store.create(input, simulation);
    const completed = await store.complete(created.id, {
      walletAddress: '0x2222222222222222222222222222222222222222',
      transactionHash: `0x${'a'.repeat(64)}`,
      completedAt: new Date().toISOString(),
    });
    expect(completed.status).toBe('submitted');

    const reloaded = new RequestStore(file);
    await reloaded.initialize();
    expect((await reloaded.get(created.id))?.result?.transactionHash).toBe(`0x${'a'.repeat(64)}`);
  });

  it('expires pending requests according to the stored deadline', async () => {
    const store = new RequestStore(path.join(directory, 'requests.json'));
    await store.initialize();
    const created = await store.create(
      evmRequestInputSchema.parse({
        chain: 'evm',
        title: 'Expiring transaction',
        asciiExplanation,
        mode: 'sign',
        expiresInMinutes: 1,
        chainId: 1,
        transaction: { to: '0x1111111111111111111111111111111111111111' },
      }),
      simulation,
    );
    vi.setSystemTime(new Date('2026-07-31T12:02:00.000Z'));
    expect((await store.get(created.id))?.status).toBe('expired');
  });
});
