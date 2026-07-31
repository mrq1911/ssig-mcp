import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TransactionRequest } from '../shared/schema';
import { completeRequest, listRequests, rejectRequest } from './api';
import { shorten } from './encoding';
import { transactionPreview } from './preview';
import { approveEvm, useEvmWallets } from './wallets/evm';
import { approveSolana, useSolanaWallets } from './wallets/solana';
import { approveSui, useSuiWallets } from './wallets/sui';

const LOGO = String.raw`
  ____  ____  ___ ____
 / ___|/ ___||_ _/ ___|
 \___ \\___ \ | |\___ \
  ___) |___) || | ___) |
 |____/|____/|___|____/
`;

function requestNetwork(request: TransactionRequest): string {
  if (request.chain === 'evm') return request.networkName ?? `eip155:${request.chainId}`;
  return request.network;
}

function statusTone(status: TransactionRequest['status']): string {
  if (status === 'pending') return 'tone-warn';
  if (status === 'approved' || status === 'submitted') return 'tone-ok';
  return 'tone-bad';
}

function Queue({
  requests,
  selected,
  onSelect,
}: {
  requests: TransactionRequest[];
  selected: string | undefined;
  onSelect(id: string): void;
}) {
  return (
    <aside className="queue-panel panel">
      <div className="panel-title">/SIGN_QUEUE</div>
      <div className="queue-count">{requests.length.toString().padStart(2, '0')} REQUESTS</div>
      <nav aria-label="Transaction requests">
        {requests.length === 0 ? (
          <p className="muted">&gt; awaiting agent uplink<span className="cursor">_</span></p>
        ) : (
          requests.map((request) => (
            <button
              className={`queue-item ${selected === request.id ? 'active' : ''}`}
              key={request.id}
              onClick={() => onSelect(request.id)}
              type="button"
            >
              <span className="queue-line">
                <span>{request.chain.toUpperCase()}</span>
                <span className={statusTone(request.status)}>{request.status}</span>
              </span>
              <span className="queue-title">{request.title}</span>
              <span className="queue-id">#{request.id.slice(0, 8)}</span>
            </button>
          ))
        )}
      </nav>
    </aside>
  );
}

function SimulationPanel({ request }: { request: TransactionRequest }) {
  const simulation = request.simulation;
  return (
    <section className={`panel simulation simulation-${simulation.status}`}>
      <div className="panel-title">/DRY_RUN :: {simulation.provider.toUpperCase()}</div>
      <div className="simulation-head">
        <span className={`status-lamp ${simulation.status}`} aria-hidden="true" />
        <strong>{simulation.status.toUpperCase()}</strong>
      </div>
      <p>{simulation.summary}</p>
      {simulation.details !== undefined && (
        <details>
          <summary>[ VIEW SIMULATION TRACE ]</summary>
          <pre className="data-block">{JSON.stringify(simulation.details, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}

function WalletApproval({
  request,
  onUpdated,
}: {
  request: TransactionRequest;
  onUpdated(request: TransactionRequest): void;
}) {
  const evmWallets = useEvmWallets();
  const solanaWallets = useSolanaWallets();
  const suiNetwork = request.chain === 'sui' ? request.network.slice(4) : 'mainnet';
  const suiWallets = useSuiWallets(
    suiNetwork as 'mainnet' | 'testnet' | 'devnet' | 'localnet',
  );
  const [walletIndex, setWalletIndex] = useState('0');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setWalletIndex('0');
    setConfirmed(false);
    setError('');
  }, [request.id]);

  const wallets =
    request.chain === 'evm'
      ? evmWallets.map((wallet) => wallet.name)
      : request.chain === 'solana'
        ? solanaWallets.map((wallet) => wallet.name)
        : suiWallets.map((wallet) => wallet.name);

  if (request.status !== 'pending') {
    return (
      <section className="panel result-panel">
        <div className="panel-title">/REQUEST_RESULT</div>
        <p className={statusTone(request.status)}>&gt; STATUS: {request.status.toUpperCase()}</p>
        {request.result && <pre className="data-block">{JSON.stringify(request.result, null, 2)}</pre>}
        {request.error && <p className="tone-bad">{request.error}</p>}
      </section>
    );
  }

  const approve = async () => {
    setBusy(true);
    setError('');
    try {
      const index = Number(walletIndex);
      let result;
      if (request.chain === 'evm') {
        const wallet = evmWallets[index];
        if (!wallet) throw new Error('Select an EVM wallet extension');
        result = await approveEvm(request, wallet);
      } else if (request.chain === 'solana') {
        const wallet = solanaWallets[index];
        if (!wallet) throw new Error('Select a Solana Wallet Standard extension');
        result = await approveSolana(request, wallet);
      } else {
        const wallet = suiWallets[index];
        if (!wallet) throw new Error('Select a Sui Wallet Standard extension');
        result = await approveSui(request, wallet);
      }
      onUpdated(await completeRequest(request.id, result));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!window.confirm('Reject this transaction request? This cannot be undone.')) return;
    setBusy(true);
    setError('');
    try {
      onUpdated(await rejectRequest(request.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel approval-panel">
      <div className="panel-title">/HARDWARE_GATE</div>
      <p className="command">$ wallet connect --chain={request.chain} --mode={request.mode}</p>
      {wallets.length ? (
        <label className="field">
          <span>WALLET EXTENSION</span>
          <select value={walletIndex} onChange={(event) => setWalletIndex(event.target.value)}>
            {wallets.map((name, index) => (
              <option key={`${name}-${index}`} value={String(index)}>
                {name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="tone-bad">[!] No compatible {request.chain} wallet detected. Unlock or install one.</p>
      )}
      {request.mode === 'sign' && request.chain === 'evm' && (
        <p className="tone-warn">[!] Many EVM extensions reject eth_signTransaction. Use sign-and-submit if yours does.</p>
      )}
      <label className="confirm-row">
        <input
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          type="checkbox"
        />
        <span>I compared the network, signer, amounts, destination, and wallet preview.</span>
      </label>
      {error && <pre className="error-box">ERROR :: {error}</pre>}
      <div className="button-row">
        <button className="button danger" disabled={busy} onClick={reject} type="button">
          [ REJECT ]
        </button>
        <button
          className="button primary"
          disabled={busy || !confirmed || wallets.length === 0}
          onClick={approve}
          type="button"
        >
          {busy ? '[ WAITING FOR WALLET... ]' : `[ ${request.mode === 'sign' ? 'SIGN' : 'SIGN + SUBMIT'} ]`}
        </button>
      </div>
    </section>
  );
}

function RequestView({
  request,
  onUpdated,
}: {
  request: TransactionRequest;
  onUpdated(request: TransactionRequest): void;
}) {
  const preview = useMemo(() => transactionPreview(request), [request]);
  const expires = new Date(request.expiresAt).toLocaleString();

  return (
    <main className="request-view">
      <section className="request-header panel">
        <div>
          <div className="eyebrow">INCOMING TRANSACTION :: {request.chain.toUpperCase()}</div>
          <h1>{request.title}</h1>
          <p className="request-meta">
            ID {request.id} // NETWORK {requestNetwork(request)} // EXPIRES {expires}
          </p>
        </div>
        <span className={`status-chip ${statusTone(request.status)}`}>{request.status}</span>
      </section>

      <section className="panel ascii-panel">
        <div className="panel-title">/AGENT_EXPLANATION.ASC</div>
        <p className="untrusted">UNTRUSTED AGENT CONTEXT — VERIFY AGAINST RAW DATA AND WALLET PREVIEW</p>
        <pre>{request.asciiExplanation}</pre>
      </section>

      <div className="two-column">
        <SimulationPanel request={request} />
        <section className="panel facts-panel">
          <div className="panel-title">/SIGNING_CONSTRAINTS</div>
          <dl>
            <div><dt>CHAIN</dt><dd>{request.chain}</dd></div>
            <div><dt>NETWORK</dt><dd>{requestNetwork(request)}</dd></div>
            <div><dt>MODE</dt><dd>{request.mode}</dd></div>
            <div><dt>SIGNER</dt><dd>{request.expectedSigner ? shorten(request.expectedSigner, 12) : 'any connected account'}</dd></div>
          </dl>
        </section>
      </div>

      <section className="panel raw-panel">
        <div className="panel-title">/DECODED_TRANSACTION</div>
        <pre className="data-block">{JSON.stringify(preview, null, 2)}</pre>
        {request.chain !== 'evm' && (
          <details>
            <summary>[ VIEW EXACT BASE64 PAYLOAD ]</summary>
            <pre className="data-block raw-payload">{request.transactionBase64}</pre>
          </details>
        )}
      </section>

      <WalletApproval request={request} onUpdated={onUpdated} />
    </main>
  );
}

export default function App() {
  const requestedId = new URL(window.location.href).searchParams.get('request') ?? undefined;
  const [requests, setRequests] = useState<TransactionRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(requestedId);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await listRequests();
      setRequests(next);
      setSelectedId((current) =>
        current && next.some((request) => request.id === current)
          ? current
          : next.find((request) => request.status === 'pending')?.id ?? next[0]?.id,
      );
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const updateRequest = (updated: TransactionRequest) => {
    setRequests((current) =>
      current.map((request) => (request.id === updated.id ? updated : request)),
    );
  };
  const selected = requests.find((request) => request.id === selectedId);

  return (
    <div className="crt-shell">
      <div className="scanlines" aria-hidden="true" />
      <header className="system-bar">
        <span>SSIG::MCP_BRIDGE</span>
        <span className="system-center">LOCALHOST SECURE CONSOLE</span>
        <span>{new Date().toLocaleDateString('en-CA')}</span>
      </header>
      <section className="boot-banner">
        <pre aria-label="SSIG">{LOGO}</pre>
        <div>
          <p>SELF-SOVEREIGN SIGNING INTERFACE</p>
          <p className="muted">KEY MATERIAL: BROWSER WALLET ONLY // MCP CUSTODY: NONE</p>
        </div>
      </section>

      {error && <div className="global-error">FATAL :: {error}</div>}
      <div className="shell-grid">
        <Queue requests={requests} selected={selectedId} onSelect={setSelectedId} />
        {selected ? (
          <RequestView request={selected} onUpdated={updateRequest} />
        ) : (
          <main className="empty-state panel">
            <p>{loading ? '> booting request index...' : '> no transaction selected'}</p>
            <p className="muted">The MCP agent can queue EVM, Solana, or Sui transactions.</p>
          </main>
        )}
      </div>
      <footer>
        <span>NO PRIVATE KEYS CROSS THIS BOUNDARY</span>
        <span>VERIFY ON WALLET // SIMULATION IS NOT A GUARANTEE</span>
      </footer>
    </div>
  );
}
