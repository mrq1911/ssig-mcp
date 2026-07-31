# SSIG MCP

SSIG is a local MCP-to-browser signing bridge for EVM, Solana, and Sui. An agent can prepare and simulate a transaction, but it cannot access a private key or approve the wallet prompt. You inspect the request in a retro terminal UI and sign with an extension already installed in your browser.

## What it does

- Exposes separate MCP tools for EVM, Solana, and Sui transaction requests.
- Requires an ASCII-only agent explanation for every request.
- Automatically attempts a dry run before adding the request to the queue.
- Serves an authenticated approval UI on loopback by default, with explicit RFC1918 LAN mode.
- Discovers EIP-6963/EIP-1193 EVM wallets, Solana Wallet Standard wallets, and Sui Wallet Standard wallets.
- Supports `sign` and `sign-and-submit` modes.
- Persists request state, never keys, in `~/.ssig/requests.json` with owner-only permissions.

The UI keeps three pieces of evidence separate:

1. The agent's ASCII explanation (explicitly marked untrusted).
2. The dry-run output.
3. Decoded and exact serialized transaction data.

The browser wallet's own confirmation screen is the final authority.

## Install and build

Requirements: Node.js 20 or newer and a compatible browser wallet extension.

```bash
npm install
npm run build
npm test
```

Run it manually with:

```bash
npm start
```

The process prints the terminal URL to stderr. MCP itself uses stdin/stdout, so an MCP client will normally start the process for you.

## MCP configuration

Add a local stdio server to your MCP client, using the absolute path to the built entrypoint:

```json
{
  "mcpServers": {
    "ssig": {
      "command": "node",
      "args": ["/absolute/path/to/ssig/dist/server/server/index.js"],
      "env": {
        "SSIG_PORT": "3721"
      }
    }
  }
}
```

The available tools are:

- `request_evm_transaction`
- `request_solana_transaction`
- `request_sui_transaction`
- `get_transaction_request`
- `list_transaction_requests`
- `cancel_transaction_request`

The three request tools return an `approvalUrl`. Open that URL in the browser profile containing your wallet extension.

## Required ASCII explanation

`asciiExplanation` rejects non-ASCII characters. The agent should name amounts, assets, recipients, expected state changes, and material risk. For example:

```text
+------------------- SWAP --------------------+
| INPUT  : 100.00 USDC                       |
| ROUTE  : USDC -> WETH via 0xRouter...      |
| MIN OUT: 0.031 WETH                        |
| SIGNER : 0x1234...abcd                     |
| RESULT : USDC decreases; WETH increases    |
| RISK   : slippage, malicious router, MEV   |
+---------------------------------------------+
```

This explanation is context, not proof. Compare it with the decoded payload, dry run, and extension preview.

## Transaction formats

### EVM

Pass `chainId`, an optional `expectedSigner`, and an EIP-1193 transaction object. Quantities must use canonical JSON-RPC hex (`0x0`, `0x1`, and so on). SSIG checks the active chain and never calls `wallet_addEthereumChain`; unknown networks must be added by you through a trusted wallet flow.

`sign-and-submit` uses `eth_sendTransaction`. `sign` uses `eth_signTransaction`, which many consumer wallets intentionally do not support.

### Solana

Pass a Wallet Standard chain identifier and a base64-encoded wire transaction:

- `solana:mainnet`
- `solana:devnet`
- `solana:testnet`
- `solana:localnet`

The transaction can be unsigned or partially signed. The extension receives the exact decoded bytes through `solana:signTransaction` or `solana:signAndSendTransaction`.

### Sui

Pass a Sui Wallet Standard chain identifier and base64-encoded BCS `TransactionData` bytes:

- `sui:mainnet`
- `sui:testnet`
- `sui:devnet`
- `sui:localnet`

SSIG uses Mysten's dApp Kit compatibility layer, including modern and legacy Sui Wallet Standard features.

## Dry-run configuration

Simulation destinations are configured by the server owner, never by an MCP tool argument. This prevents an agent from turning the bridge into an arbitrary network client.

### EVM

Tenderly is preferred when all three settings are present:

```bash
SSIG_TENDERLY_ACCOUNT=my-account
SSIG_TENDERLY_PROJECT=my-project
SSIG_TENDERLY_ACCESS_KEY=secret
```

If Tenderly is unavailable or fails, SSIG can fall back to `eth_call` plus `eth_estimateGas` through a chain-ID map:

```bash
SSIG_EVM_RPC_URLS='{"1":"https://ethereum.example/rpc","8453":"https://base.example/rpc"}'
```

Tenderly needs `expectedSigner` because the sender is required for an accurate simulation.

### Solana

SSIG calls the native `simulateTransaction` RPC with signature verification disabled and recent-blockhash replacement enabled:

```bash
SSIG_SOLANA_RPC_URLS='{"solana:mainnet":"https://solana.example/rpc","solana:devnet":"https://api.devnet.solana.com"}'
```

### Sui

SSIG calls the current Sui Core API `simulateTransaction` over gRPC:

```bash
SSIG_SUI_GRPC_URLS='{"sui:mainnet":"https://fullnode.mainnet.sui.io:443","sui:testnet":"https://fullnode.testnet.sui.io:443"}'
```

### Simulation policy

By default, an unavailable simulator is shown prominently but does not prevent signing. A simulation that executes and reports failure is blocked by default.

```bash
# Refuse requests when simulation is unavailable or errors.
SSIG_REQUIRE_SIMULATION=true

# Allow the user to inspect and sign even after a simulated execution failure.
SSIG_BLOCK_FAILED_SIMULATION=false
```

Simulation is point-in-time and provider-dependent. It cannot guarantee later execution, protect against every state change, or prove the agent's explanation is accurate. Sending a transaction to a simulation provider also reveals its contents to that provider.

## Other configuration

### Trusted-LAN access

Loopback is the secure default. To open the approval terminal from another machine on the same
trusted private network, opt in explicitly and advertise this machine's RFC1918 address:

```bash
SSIG_HOST=0.0.0.0 \
SSIG_ALLOW_LAN=true \
SSIG_PUBLIC_HOST=192.168.1.50 \
npm start
```

LAN mode continues to require the random UI bearer token and accepts only loopback or the exact
`SSIG_PUBLIC_HOST` value in the HTTP `Host` header. It uses plain HTTP, so use only a trusted LAN;
on shared or hostile networks, keep loopback mode and use an SSH port-forward instead.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SSIG_HOST` | `127.0.0.1` | Bind address. LAN mode accepts `0.0.0.0` or a private IPv4 address. |
| `SSIG_ALLOW_LAN` | `false` | Required explicit opt-in for non-loopback binding. |
| `SSIG_PUBLIC_HOST` | — | Exact RFC1918 address advertised and allowed in LAN mode. |
| `SSIG_PORT` | `3721` | UI/API port. Use `0` to choose a free port. |
| `SSIG_DATA_DIR` | `~/.ssig` | Persistent request-state directory. |
| `SSIG_REQUEST_LIMIT` | `1000` | Maximum retained requests; pending requests are never pruned. |
| `SSIG_WEB_DIR` | bundled `dist/web` | Override the static browser build location. |

## Security boundaries

- SSIG binds only to loopback by default. LAN mode is explicit, RFC1918-only, and allowlists one exact `Host` value to reduce DNS-rebinding risk.
- The approval API uses a random 256-bit bearer token. The browser stores it in session storage and immediately removes it from the URL.
- API responses are `no-store`, the UI cannot be framed, and a restrictive Content Security Policy is applied.
- The server validates the connected wallet against `expectedSigner` again when recording completion.
- RPC URLs come only from administrator environment variables.
- The MCP never receives seed phrases, private keys, or extension secrets.
- An agent can still propose a malicious transaction or misleading ASCII explanation. Always read the extension preview and use small-value test transactions first.

## Development

```bash
npm run typecheck
npm test
npm run build
```

The browser interface is visually inspired by [AnderShell 3000](https://github.com/andersevenrud/retro-css-shell-demo). See [NOTICE](./NOTICE) for attribution.
