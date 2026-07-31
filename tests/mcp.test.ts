import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/server/config.js';
import { buildMcpServer } from '../src/server/mcp.js';
import { SigningService } from '../src/server/service.js';
import { asciiExplanation } from './fixtures.js';

describe('MCP server', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'ssig-mcp-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('advertises chain tools and queues an EVM approval', async () => {
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
    const service = new SigningService(config);
    await service.initialize();
    service.setBaseUrl('http://127.0.0.1:3721');
    const server = buildMcpServer(service);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'request_evm_transaction',
        'request_solana_transaction',
        'request_sui_transaction',
        'get_transaction_request',
      ]),
    );

    const result = await client.callTool({
      name: 'request_evm_transaction',
      arguments: {
        title: 'MCP queued transfer',
        asciiExplanation,
        mode: 'sign-and-submit',
        chainId: 1,
        transaction: { to: '0x1111111111111111111111111111111111111111' },
      },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain('approvalUrl');
    expect((await service.list()).length).toBe(1);

    const malformed = await client.callTool({
      name: 'request_solana_transaction',
      arguments: {
        title: 'Malformed Solana transfer',
        asciiExplanation,
        mode: 'sign',
        network: 'solana:devnet',
        transactionBase64: 'AAAA',
      },
    });
    expect(malformed.isError).toBe(true);
    expect((await service.list()).length).toBe(1);

    await client.close();
    await server.close();
  });
});
