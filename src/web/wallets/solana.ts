import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount, WalletWithFeatures } from '@wallet-standard/base';
import { StandardConnect, type StandardConnectFeature } from '@wallet-standard/features';
import {
  SolanaSignAndSendTransaction,
  SolanaSignTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features';
import bs58 from 'bs58';
import { useEffect, useState } from 'react';
import type { TransactionRequest } from '../../shared/schema';
import { fromBase64, toBase64 } from '../encoding';

type SolanaWallet = WalletWithFeatures<
  StandardConnectFeature &
    Partial<SolanaSignTransactionFeature & SolanaSignAndSendTransactionFeature>
>;

function isSolanaWallet(wallet: Wallet): wallet is SolanaWallet {
  return (
    StandardConnect in wallet.features &&
    (SolanaSignTransaction in wallet.features || SolanaSignAndSendTransaction in wallet.features)
  );
}

export function useSolanaWallets(): readonly SolanaWallet[] {
  const registry = getWallets();
  const read = () => registry.get().filter(isSolanaWallet);
  const [wallets, setWallets] = useState<readonly SolanaWallet[]>(read);
  useEffect(() => {
    const refresh = () => setWallets(read());
    const offRegister = registry.on('register', refresh);
    const offUnregister = registry.on('unregister', refresh);
    refresh();
    return () => {
      offRegister();
      offUnregister();
    };
  }, [registry]);
  return wallets;
}

function selectAccount(
  accounts: readonly WalletAccount[],
  request: Extract<TransactionRequest, { chain: 'solana' }>,
): WalletAccount {
  const supported = accounts.filter(
    (account) =>
      account.chains.includes(request.network) &&
      account.features.includes(
        request.mode === 'sign' ? SolanaSignTransaction : SolanaSignAndSendTransaction,
      ),
  );
  const account = request.expectedSigner
    ? supported.find((candidate) => candidate.address === request.expectedSigner)
    : supported[0];
  if (!account) {
    throw new Error(
      request.expectedSigner
        ? `Wallet does not expose expected ${request.expectedSigner} on ${request.network}`
        : `Wallet has no compatible account on ${request.network}`,
    );
  }
  return account;
}

export async function approveSolana(
  request: Extract<TransactionRequest, { chain: 'solana' }>,
  wallet: SolanaWallet,
) {
  const connected = await wallet.features[StandardConnect].connect();
  const account = selectAccount(connected.accounts, request);
  const input = {
    account,
    transaction: fromBase64(request.transactionBase64),
    chain: request.network,
    options: { preflightCommitment: 'confirmed' as const },
  };

  if (request.mode === 'sign') {
    const feature = wallet.features[SolanaSignTransaction];
    if (!feature) throw new Error(`${wallet.name} does not support sign-only transactions`);
    const [output] = await feature.signTransaction(input);
    if (!output) throw new Error('Wallet returned no signed transaction');
    return {
      walletAddress: account.address,
      signedTransactionBase64: toBase64(output.signedTransaction),
    };
  }

  const feature = wallet.features[SolanaSignAndSendTransaction];
  if (!feature) throw new Error(`${wallet.name} does not support sign-and-submit transactions`);
  const [output] = await feature.signAndSendTransaction(input);
  if (!output) throw new Error('Wallet returned no transaction signature');
  const signature = bs58.encode(output.signature);
  return { walletAddress: account.address, signature, transactionHash: signature };
}

export type { SolanaWallet };
