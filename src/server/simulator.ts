import { SuiGrpcClient } from '@mysten/sui/grpc';
import { fromBase64 } from '@mysten/sui/utils';
import type { AppConfig } from './config.js';
import { errorMessage, toJsonSafe } from './json.js';
import type {
  EvmRequestInput,
  EvmTransaction,
  Simulation,
  SolanaRequestInput,
  SuiRequestInput,
  TransactionInput,
} from '../shared/schema.js';

const MAX_RESPONSE_BYTES = 2_000_000;
const SIMULATION_TIMEOUT_MS = 20_000;

type JsonRpcResponse = {
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

function now(): string {
  return new Date().toISOString();
}

function limitedDetails(value: unknown): unknown {
  const safe = toJsonSafe(value);
  const serialized = JSON.stringify(safe);
  if (serialized.length <= MAX_RESPONSE_BYTES) return safe;
  return `${serialized.slice(0, MAX_RESPONSE_BYTES)}...[truncated]`;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const announcedLength = Number(response.headers.get('content-length') ?? 0);
  if (announcedLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Simulation response exceeded ${MAX_RESPONSE_BYTES} bytes`);
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error(`Simulation response exceeded ${MAX_RESPONSE_BYTES} bytes`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Simulation provider returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) {
    const detail =
      body && typeof body === 'object' && 'error' in body
        ? JSON.stringify((body as { error: unknown }).error)
        : response.statusText;
    throw new Error(`Simulation provider returned HTTP ${response.status}: ${detail}`);
  }
  return body;
}

async function jsonRpc(url: string, method: string, params: unknown[]): Promise<JsonRpcResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(SIMULATION_TIMEOUT_MS),
  });
  return (await readJsonResponse(response)) as JsonRpcResponse;
}

function rpcTransaction(transaction: EvmTransaction, expectedSigner?: string): Record<string, unknown> {
  return {
    ...(expectedSigner ? { from: expectedSigner } : {}),
    ...(transaction.to ? { to: transaction.to } : {}),
    data: transaction.data,
    ...(transaction.value ? { value: transaction.value } : {}),
    ...(transaction.gas ? { gas: transaction.gas } : {}),
    ...(transaction.gasPrice ? { gasPrice: transaction.gasPrice } : {}),
    ...(transaction.maxFeePerGas ? { maxFeePerGas: transaction.maxFeePerGas } : {}),
    ...(transaction.maxPriorityFeePerGas
      ? { maxPriorityFeePerGas: transaction.maxPriorityFeePerGas }
      : {}),
    ...(transaction.nonce ? { nonce: transaction.nonce } : {}),
    ...(transaction.accessList ? { accessList: transaction.accessList } : {}),
  };
}

function hexToDecimal(value: string | undefined): string | undefined {
  return value === undefined ? undefined : BigInt(value).toString(10);
}

async function simulateWithTenderly(
  request: EvmRequestInput,
  config: NonNullable<AppConfig['tenderly']>,
): Promise<Simulation> {
  if (!request.expectedSigner) {
    throw new Error('Tenderly simulation requires expectedSigner as the transaction sender');
  }
  const transaction = request.transaction;
  const body = {
    network_id: String(request.chainId),
    block_number: 'latest',
    from: request.expectedSigner,
    ...(transaction.to ? { to: transaction.to } : {}),
    input: transaction.data,
    value: hexToDecimal(transaction.value) ?? '0',
    gas: transaction.gas ? Number(BigInt(transaction.gas)) : 8_000_000,
    ...(transaction.gasPrice || transaction.maxFeePerGas
      ? { gas_price: hexToDecimal(transaction.gasPrice ?? transaction.maxFeePerGas) }
      : {}),
    save: true,
    save_if_fails: true,
    simulation_type: 'full',
  };

  const endpoint = `https://api.tenderly.co/api/v1/account/${encodeURIComponent(config.account)}/project/${encodeURIComponent(config.project)}/simulate`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Access-Key': config.accessKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SIMULATION_TIMEOUT_MS),
  });
  const result = (await readJsonResponse(response)) as Record<string, unknown>;
  const transactionResult = result.transaction as Record<string, unknown> | undefined;
  const succeeded = transactionResult?.status === true;
  return {
    status: succeeded ? 'success' : 'failed',
    provider: 'tenderly',
    performedAt: now(),
    summary: succeeded
      ? `Tenderly simulation succeeded; gas used: ${String(transactionResult?.gas_used ?? 'unknown')}`
      : `Tenderly simulation failed: ${String(transactionResult?.error_message ?? 'execution reverted')}`,
    details: limitedDetails(result),
  };
}

async function simulateWithEvmRpc(request: EvmRequestInput, url: string): Promise<Simulation> {
  const transaction = rpcTransaction(request.transaction, request.expectedSigner);
  const call = await jsonRpc(url, 'eth_call', [transaction, 'latest']);
  if (call.error) {
    return {
      status: 'failed',
      provider: 'evm-rpc',
      performedAt: now(),
      summary: `eth_call failed: ${call.error.message ?? 'execution reverted'}`,
      details: limitedDetails(call.error),
    };
  }

  const estimate = await jsonRpc(url, 'eth_estimateGas', [transaction, 'latest']);
  if (estimate.error) {
    return {
      status: 'failed',
      provider: 'evm-rpc',
      performedAt: now(),
      summary: `eth_call succeeded but gas estimation failed: ${estimate.error.message ?? 'unknown error'}`,
      details: limitedDetails({ call: call.result, estimateError: estimate.error }),
    };
  }
  return {
    status: 'success',
    provider: 'evm-rpc',
    performedAt: now(),
    summary: `RPC preflight succeeded; estimated gas: ${String(estimate.result)}`,
    details: limitedDetails({ callResult: call.result, estimatedGas: estimate.result }),
  };
}

async function simulateEvm(request: EvmRequestInput, config: AppConfig): Promise<Simulation> {
  const errors: string[] = [];
  if (config.tenderly) {
    try {
      return await simulateWithTenderly(request, config.tenderly);
    } catch (error) {
      errors.push(`Tenderly: ${errorMessage(error)}`);
    }
  }
  const rpcUrl = config.evmRpcUrls[String(request.chainId)];
  if (rpcUrl) {
    try {
      return await simulateWithEvmRpc(request, rpcUrl);
    } catch (error) {
      errors.push(`EVM RPC: ${errorMessage(error)}`);
    }
  }
  if (errors.length > 0) {
    return {
      status: 'error',
      provider: config.tenderly ? 'tenderly' : 'evm-rpc',
      performedAt: now(),
      summary: errors.join(' | ').slice(0, 1_000),
    };
  }
  return {
    status: 'unavailable',
    provider: 'none',
    performedAt: now(),
    summary: `No Tenderly credentials or EVM RPC configured for chain ${request.chainId}`,
  };
}

async function simulateSolana(
  request: SolanaRequestInput,
  config: AppConfig,
): Promise<Simulation> {
  const network = request.network.slice('solana:'.length);
  const rpcUrl = config.solanaRpcUrls[request.network] ?? config.solanaRpcUrls[network];
  if (!rpcUrl) {
    return {
      status: 'unavailable',
      provider: 'none',
      performedAt: now(),
      summary: `No Solana RPC configured for ${request.network}`,
    };
  }
  try {
    const response = await jsonRpc(rpcUrl, 'simulateTransaction', [
      request.transactionBase64,
      {
        encoding: 'base64',
        commitment: 'confirmed',
        replaceRecentBlockhash: true,
        sigVerify: false,
        innerInstructions: true,
      },
    ]);
    if (response.error) throw new Error(response.error.message ?? 'Solana RPC error');
    const value = (response.result as { value?: Record<string, unknown> } | undefined)?.value;
    if (!value) throw new Error('Solana RPC returned no simulation value');
    const failed = value.err !== null && value.err !== undefined;
    return {
      status: failed ? 'failed' : 'success',
      provider: 'solana-rpc',
      performedAt: now(),
      summary: failed
        ? `Solana simulation failed: ${JSON.stringify(value.err)}`
        : `Solana simulation succeeded; compute units: ${String(value.unitsConsumed ?? 'unknown')}`,
      details: limitedDetails(response.result),
    };
  } catch (error) {
    return {
      status: 'error',
      provider: 'solana-rpc',
      performedAt: now(),
      summary: errorMessage(error).slice(0, 1_000),
    };
  }
}

async function simulateSui(request: SuiRequestInput, config: AppConfig): Promise<Simulation> {
  const network = request.network.slice('sui:'.length);
  const grpcUrl = config.suiGrpcUrls[request.network] ?? config.suiGrpcUrls[network];
  if (!grpcUrl) {
    return {
      status: 'unavailable',
      provider: 'none',
      performedAt: now(),
      summary: `No Sui gRPC endpoint configured for ${request.network}`,
    };
  }
  try {
    const client = new SuiGrpcClient({ network, baseUrl: grpcUrl });
    const result = await client.core.simulateTransaction({
      transaction: fromBase64(request.transactionBase64),
      include: {
        balanceChanges: true,
        effects: true,
        events: true,
        transaction: true,
        commandResults: true,
        protoJson: true,
      },
      signal: AbortSignal.timeout(SIMULATION_TIMEOUT_MS),
    });
    const transaction = result.Transaction ?? result.FailedTransaction;
    const succeeded = result.$kind === 'Transaction' && transaction.status.success;
    return {
      status: succeeded ? 'success' : 'failed',
      provider: 'sui-grpc',
      performedAt: now(),
      summary: succeeded
        ? 'Sui simulation succeeded'
        : `Sui simulation failed: ${transaction.status.error?.message ?? 'execution failed'}`,
      details: limitedDetails(result),
    };
  } catch (error) {
    return {
      status: 'error',
      provider: 'sui-grpc',
      performedAt: now(),
      summary: errorMessage(error).slice(0, 1_000),
    };
  }
}

export async function simulateTransaction(
  request: TransactionInput,
  config: AppConfig,
): Promise<Simulation> {
  switch (request.chain) {
    case 'evm':
      return simulateEvm(request, config);
    case 'solana':
      return simulateSolana(request, config);
    case 'sui':
      return simulateSui(request, config);
  }
}
