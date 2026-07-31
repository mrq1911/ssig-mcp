import { bcs } from '@mysten/sui/bcs';
import { fromBase64 as fromSuiBase64 } from '@mysten/sui/utils';
import type { TransactionRequest } from '../shared/schema';
import { decodeSolanaWire } from '../shared/solana-wire';
import { fromBase64, jsonSafe } from './encoding';

export { decodeSolanaWire } from '../shared/solana-wire';

export function transactionPreview(request: TransactionRequest): unknown {
  if (request.chain === 'evm') {
    return {
      chainId: request.chainId,
      networkName: request.networkName ?? null,
      expectedSigner: request.expectedSigner ?? null,
      mode: request.mode,
      transaction: request.transaction,
      valueDecimalWei: request.transaction.value
        ? BigInt(request.transaction.value).toString(10)
        : '0',
    };
  }

  if (request.chain === 'solana') {
    try {
      const bytes = fromBase64(request.transactionBase64);
      return { network: request.network, mode: request.mode, ...decodeSolanaWire(bytes) };
    } catch (error) {
      return {
        network: request.network,
        byteLength: fromBase64(request.transactionBase64).byteLength,
        decodeError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  try {
    const bytes = fromSuiBase64(request.transactionBase64);
    return {
      network: request.network,
      mode: request.mode,
      byteLength: bytes.byteLength,
      transactionData: jsonSafe(bcs.TransactionData.parse(bytes)),
    };
  } catch (error) {
    return {
      network: request.network,
      byteLength: fromBase64(request.transactionBase64).byteLength,
      decodeError: error instanceof Error ? error.message : String(error),
    };
  }
}
