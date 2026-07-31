import { useEffect, useState } from 'react';
import type { EvmRequestInput, TransactionRequest } from '../../shared/schema';

export type Eip1193Provider = {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
};

export type EvmWallet = {
  id: string;
  name: string;
  provider: Eip1193Provider;
};

type Eip6963Detail = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function useEvmWallets(): EvmWallet[] {
  const [wallets, setWallets] = useState<EvmWallet[]>([]);

  useEffect(() => {
    const discovered = new Map<string, EvmWallet>();
    const update = () => setWallets([...discovered.values()]);
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963Detail>).detail;
      if (!detail?.provider || !detail.info) return;
      discovered.set(detail.info.uuid, {
        id: detail.info.uuid,
        name: detail.info.name,
        provider: detail.provider,
      });
      update();
    };
    window.addEventListener('eip6963:announceProvider', announce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    if (window.ethereum) {
      discovered.set('window.ethereum', {
        id: 'window.ethereum',
        name: 'Browser EVM wallet',
        provider: window.ethereum,
      });
      update();
    }
    return () => window.removeEventListener('eip6963:announceProvider', announce);
  }, []);

  return wallets;
}

function normalizeSignedTransaction(value: unknown): string {
  if (typeof value === 'string' && value.startsWith('0x')) return value;
  if (value && typeof value === 'object') {
    const candidate = value as { raw?: unknown; rawTransaction?: unknown };
    if (typeof candidate.raw === 'string' && candidate.raw.startsWith('0x')) return candidate.raw;
    if (
      typeof candidate.rawTransaction === 'string' &&
      candidate.rawTransaction.startsWith('0x')
    ) {
      return candidate.rawTransaction;
    }
  }
  throw new Error('Wallet returned an unsupported eth_signTransaction result');
}

export async function approveEvm(
  request: Extract<TransactionRequest, { chain: 'evm' }>,
  wallet: EvmWallet,
) {
  const accounts = (await wallet.provider.request({ method: 'eth_requestAccounts' })) as string[];
  const account = accounts[0];
  if (!account) throw new Error('Wallet did not provide an account');
  if (request.expectedSigner && account.toLowerCase() !== request.expectedSigner.toLowerCase()) {
    throw new Error(`Select expected account ${request.expectedSigner} in the wallet`);
  }

  const targetChain = `0x${request.chainId.toString(16)}`;
  const currentChain = String(await wallet.provider.request({ method: 'eth_chainId' }));
  if (currentChain.toLowerCase() !== targetChain.toLowerCase()) {
    try {
      await wallet.provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetChain }],
      });
    } catch (error) {
      throw new Error(
        `Switch the wallet to chain ${request.chainId}. SSIG will not add untrusted networks automatically. ${error instanceof Error ? error.message : ''}`,
      );
    }
  }

  const transaction: Record<string, unknown> = {
    ...request.transaction,
    from: account,
  } satisfies EvmRequestInput['transaction'] & { from: string };

  if (request.mode === 'sign') {
    const signed = await wallet.provider.request({
      method: 'eth_signTransaction',
      params: [transaction],
    });
    return { walletAddress: account, signedTransactionHex: normalizeSignedTransaction(signed) };
  }

  const hash = await wallet.provider.request({
    method: 'eth_sendTransaction',
    params: [transaction],
  });
  if (typeof hash !== 'string') throw new Error('Wallet did not return a transaction hash');
  return { walletAddress: account, transactionHash: hash };
}
