import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/server/config.js';
import { isLoopbackHost, isValidUiToken, validateCompletion } from '../src/server/http.js';
import { SigningService } from '../src/server/service.js';
import { evmRequestInputSchema } from '../src/shared/schema.js';
import { asciiExplanation } from './fixtures.js';

describe('HTTP approval API', () => {
  let directory: string;
  let service: SigningService;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'ssig-http-'));
    const config: AppConfig = {
      host: '127.0.0.1',
      port: 0,
      dataFile: path.join(directory, 'requests.json'),
      webDirectory: directory,
      requestLimit: 100,
      requireSimulation: false,
      blockFailedSimulation: true,
      evmRpcUrls: {},
      solanaRpcUrls: {},
      suiGrpcUrls: {},
    };
    service = new SigningService(config);
    await service.initialize();
    service.setBaseUrl('http://127.0.0.1:3721');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('requires the UI bearer token and enforces the expected signer', async () => {
    const created = await service.create(
      evmRequestInputSchema.parse({
        chain: 'evm',
        title: 'Protected transaction',
        asciiExplanation,
        mode: 'sign-and-submit',
        chainId: 1,
        expectedSigner: '0x2222222222222222222222222222222222222222',
        transaction: { to: '0x1111111111111111111111111111111111111111' },
      }),
    );
    expect(isValidUiToken(service.uiToken, undefined)).toBe(false);
    expect(isValidUiToken(service.uiToken, `Bearer ${service.uiToken}`)).toBe(true);

    await expect(
      validateCompletion(created, {
        walletAddress: '0x3333333333333333333333333333333333333333',
        transactionHash: '0xbad',
      }),
    ).rejects.toThrow(/does not match expected signer/);

    const result = {
      walletAddress: '0x2222222222222222222222222222222222222222',
      transactionHash: `0x${'a'.repeat(64)}`,
    };
    await validateCompletion(created, result);
    const completed = await service.complete(created.id, {
      ...result,
      completedAt: new Date().toISOString(),
    });
    expect(completed.status).toBe('submitted');
  });

  it('rejects DNS-rebinding Host headers', async () => {
    expect(isLoopbackHost('127.0.0.1:3721')).toBe(true);
    expect(isLoopbackHost('localhost:3721')).toBe(true);
    expect(isLoopbackHost('evil.example')).toBe(false);
  });
});
