import { createDAppKit } from '@mysten/dapp-kit-core';
import type { UiWallet } from '@mysten/dapp-kit-core';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { normalizeSuiAddress, toBase64 } from '@mysten/sui/utils';
import { useEffect, useState } from 'react';
import type { TransactionRequest } from '../../shared/schema';

const networks: ['mainnet', 'testnet', 'devnet', 'localnet'] = [
  'mainnet',
  'testnet',
  'devnet',
  'localnet',
];
const grpcUrls: Record<(typeof networks)[number], string> = {
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  testnet: 'https://fullnode.testnet.sui.io:443',
  devnet: 'https://fullnode.devnet.sui.io:443',
  localnet: 'http://127.0.0.1:9000',
};

export const suiDapp = createDAppKit({
  networks,
  defaultNetwork: 'mainnet',
  createClient: (network) =>
    new SuiGrpcClient({ network, baseUrl: grpcUrls[network] }),
  autoConnect: false,
  slushWalletConfig: null,
  storage: null,
});

export function useSuiWallets(network: (typeof networks)[number]): readonly UiWallet[] {
  const [wallets, setWallets] = useState<readonly UiWallet[]>(() => suiDapp.stores.$wallets.get());
  useEffect(() => {
    suiDapp.switchNetwork(network);
    setWallets(suiDapp.stores.$wallets.get());
    return suiDapp.stores.$wallets.subscribe(setWallets);
  }, [network]);
  return wallets;
}

export async function approveSui(
  request: Extract<TransactionRequest, { chain: 'sui' }>,
  wallet: UiWallet,
) {
  const network = request.network.slice('sui:'.length) as (typeof networks)[number];
  suiDapp.switchNetwork(network);
  const { accounts } = await suiDapp.connectWallet({ wallet });
  const account = request.expectedSigner
    ? accounts.find(
        (candidate) =>
          normalizeSuiAddress(candidate.address) === normalizeSuiAddress(request.expectedSigner!),
      )
    : accounts[0];
  if (!account) {
    throw new Error(
      request.expectedSigner
        ? `Wallet does not expose expected ${request.expectedSigner}`
        : 'Wallet did not expose a Sui account',
    );
  }
  suiDapp.switchAccount({ account });

  if (request.mode === 'sign') {
    const result = await suiDapp.signTransaction({
      transaction: request.transactionBase64,
      account,
      network,
    });
    return {
      walletAddress: account.address,
      signedTransactionBase64: result.bytes,
      signature: result.signature,
    };
  }

  const result = await suiDapp.signAndExecuteTransaction({
    transaction: request.transactionBase64,
    account,
    network,
  });
  const transaction = result.Transaction ?? result.FailedTransaction;
  return {
    walletAddress: account.address,
    transactionHash: transaction.digest,
    signature: transaction.signatures[0],
    signedTransactionBase64: transaction.bcs ? toBase64(transaction.bcs) : undefined,
  };
}
