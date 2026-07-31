import { homedir } from 'node:os';
import path from 'node:path';

export type TenderlyConfig = {
  account: string;
  project: string;
  accessKey: string;
};

export type AppConfig = {
  host: '127.0.0.1' | '::1';
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
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new Error('SSIG_HOST must be a loopback address (127.0.0.1 or ::1)');
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
