import { homedir } from 'node:os';
import { isIP } from 'node:net';
import path from 'node:path';

export type TenderlyConfig = {
  account: string;
  project: string;
  accessKey: string;
};

export type AppConfig = {
  host: string;
  publicHost?: string;
  port: number;
  dataFile: string;
  webDirectory: string;
  requestLimit: number;
  requireSimulation: boolean;
  blockFailedSimulation: boolean;
  tenderly?: TenderlyConfig;
  evmRpcUrls: Record<string, string>;
  solanaRpcUrls: Record<string, string>;
  suiGrpcUrls: Record<string, string>;
};

function isPrivateIpv4(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const [first, second] = value.split('.').map(Number);
  return (
    first === 10 ||
    (first === 172 && second! >= 16 && second! <= 31) ||
    (first === 192 && second === 168)
  );
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`Expected a boolean environment value, received: ${value}`);
}

function parseUrlMap(value: string | undefined, variableName: string): Record<string, string> {
  if (!value) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${variableName} must be a JSON object of network keys to URLs`);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${variableName} must be a JSON object of network keys to URLs`);
  }

  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, rawUrl] of Object.entries(parsed)) {
    if (typeof rawUrl !== 'string') {
      throw new Error(`${variableName}.${key} must be a URL string`);
    }
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`${variableName}.${key} must use http or https`);
    }
    result[key] = url.toString();
  }
  return result;
}

function readTenderlyConfig(env: NodeJS.ProcessEnv): TenderlyConfig | undefined {
  const values = [
    env.SSIG_TENDERLY_ACCOUNT,
    env.SSIG_TENDERLY_PROJECT,
    env.SSIG_TENDERLY_ACCESS_KEY,
  ];
  if (values.every((value) => !value)) return undefined;
  if (values.some((value) => !value)) {
    throw new Error(
      'SSIG_TENDERLY_ACCOUNT, SSIG_TENDERLY_PROJECT, and SSIG_TENDERLY_ACCESS_KEY must be set together',
    );
  }
  return {
    account: values[0]!,
    project: values[1]!,
    accessKey: values[2]!,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.SSIG_HOST ?? '127.0.0.1';
  const isLoopback = host === '127.0.0.1' || host === '::1';
  let publicHost: string | undefined;
  if (!isLoopback) {
    if (!parseBoolean(env.SSIG_ALLOW_LAN, false)) {
      throw new Error(
        'Non-loopback SSIG_HOST requires SSIG_ALLOW_LAN=true and an RFC1918 SSIG_PUBLIC_HOST',
      );
    }
    if (host !== '0.0.0.0' && !isPrivateIpv4(host)) {
      throw new Error('LAN SSIG_HOST must be 0.0.0.0 or an RFC1918 IPv4 address');
    }
    publicHost = env.SSIG_PUBLIC_HOST ?? (host === '0.0.0.0' ? undefined : host);
    if (!publicHost || !isPrivateIpv4(publicHost)) {
      throw new Error('SSIG_PUBLIC_HOST must be an RFC1918 IPv4 address in LAN mode');
    }
  }

  const port = Number(env.SSIG_PORT ?? 3721);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('SSIG_PORT must be an integer between 0 and 65535');
  }

  const requestLimit = Number(env.SSIG_REQUEST_LIMIT ?? 1_000);
  if (!Number.isInteger(requestLimit) || requestLimit < 10 || requestLimit > 100_000) {
    throw new Error('SSIG_REQUEST_LIMIT must be an integer between 10 and 100000');
  }

  const defaultDataDirectory = path.join(homedir(), '.ssig');
  const dataDirectory = path.resolve(env.SSIG_DATA_DIR ?? defaultDataDirectory);
  const webDirectory = path.resolve(
    env.SSIG_WEB_DIR ?? path.join(import.meta.dirname, '..', '..', 'web'),
  );
  const tenderly = readTenderlyConfig(env);

  return {
    host,
    ...(publicHost ? { publicHost } : {}),
    port,
    dataFile: path.join(dataDirectory, 'requests.json'),
    webDirectory,
    requestLimit,
    requireSimulation: parseBoolean(env.SSIG_REQUIRE_SIMULATION, false),
    blockFailedSimulation: parseBoolean(env.SSIG_BLOCK_FAILED_SIMULATION, true),
    ...(tenderly ? { tenderly } : {}),
    evmRpcUrls: parseUrlMap(env.SSIG_EVM_RPC_URLS, 'SSIG_EVM_RPC_URLS'),
    solanaRpcUrls: parseUrlMap(env.SSIG_SOLANA_RPC_URLS, 'SSIG_SOLANA_RPC_URLS'),
    suiGrpcUrls: parseUrlMap(env.SSIG_SUI_GRPC_URLS, 'SSIG_SUI_GRPC_URLS'),
  };
}
