import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SigningService } from './service.js';
import {
  evmRequestInputSchema,
  requestStatusSchema,
  solanaRequestInputSchema,
  suiRequestInputSchema,
  type TransactionInput,
  type TransactionRequest,
} from '../shared/schema.js';

const { chain: _evmChain, ...evmToolShape } = evmRequestInputSchema.shape;
const { chain: _solanaChain, ...solanaToolShape } = solanaRequestInputSchema.shape;
const { chain: _suiChain, ...suiToolShape } = suiRequestInputSchema.shape;

function textResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

function queuedResult(service: SigningService, request: TransactionRequest) {
  return textResult({
    requestId: request.id,
    status: request.status,
    simulation: request.simulation,
    approvalUrl: service.approvalUrl(request.id),
    expiresAt: request.expiresAt,
    nextStep: 'Ask the user to open approvalUrl, inspect the ASCII explanation and simulation, then approve in their wallet extension.',
  });
}

async function queueRequest(service: SigningService, input: TransactionInput) {
  try {
    return queuedResult(service, await service.create(input));
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: error instanceof Error ? error.message : String(error),
        },
      ],
      isError: true,
    };
  }
}

export function buildMcpServer(service: SigningService): McpServer {
  const server = new McpServer({ name: 'ssig', version: '0.1.0' });

  server.registerTool(
    'request_evm_transaction',
    {
      title: 'Request EVM transaction approval',
      description:
        'Simulate and queue an EVM transaction for explicit browser-wallet approval. Never claims that a transaction is signed before the user approves it. asciiExplanation is mandatory, ASCII-only, and must explain amounts, destination, outcome, and risk.',
      inputSchema: evmToolShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => queueRequest(service, evmRequestInputSchema.parse({ ...input, chain: 'evm' })),
  );

  server.registerTool(
    'request_solana_transaction',
    {
      title: 'Request Solana transaction approval',
      description:
        'Simulate and queue a serialized Solana transaction for explicit approval with a Wallet Standard browser extension. asciiExplanation is mandatory, ASCII-only, and must explain instructions, assets, destination, outcome, and risk.',
      inputSchema: solanaToolShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) =>
      queueRequest(service, solanaRequestInputSchema.parse({ ...input, chain: 'solana' })),
  );

  server.registerTool(
    'request_sui_transaction',
    {
      title: 'Request Sui transaction approval',
      description:
        'Simulate and queue serialized Sui TransactionData for explicit approval with a Sui Wallet Standard extension. asciiExplanation is mandatory, ASCII-only, and must explain commands, objects/assets, destination, outcome, and risk.',
      inputSchema: suiToolShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => queueRequest(service, suiRequestInputSchema.parse({ ...input, chain: 'sui' })),
  );

  server.registerTool(
    'get_transaction_request',
    {
      title: 'Get transaction request status',
      description: 'Read the latest status and wallet result for one transaction request.',
      inputSchema: { requestId: z.string().uuid() },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ requestId }) => {
      const request = await service.get(requestId);
      if (!request) {
        return {
          content: [{ type: 'text' as const, text: `Transaction request ${requestId} not found` }],
          isError: true,
        };
      }
      return textResult({ ...request, approvalUrl: service.approvalUrl(request.id) });
    },
  );

  server.registerTool(
    'list_transaction_requests',
    {
      title: 'List transaction requests',
      description: 'List recent approval requests. Serialized transaction payloads are omitted.',
      inputSchema: { statuses: z.array(requestStatusSchema).max(7).optional() },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ statuses }) => {
      const requests = await service.list(statuses);
      return textResult(
        requests.map((request) => {
          const { transactionBase64: _payload, ...summary } = request as TransactionRequest & {
            transactionBase64?: string;
          };
          return { ...summary, approvalUrl: service.approvalUrl(request.id) };
        }),
      );
    },
  );

  server.registerTool(
    'cancel_transaction_request',
    {
      title: 'Cancel transaction request',
      description: 'Cancel a still-pending browser approval request.',
      inputSchema: { requestId: z.string().uuid() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ requestId }) => {
      try {
        return textResult(await service.cancel(requestId));
      } catch (error) {
        return {
          content: [
            { type: 'text' as const, text: error instanceof Error ? error.message : String(error) },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}
