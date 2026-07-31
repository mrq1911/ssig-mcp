import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { fromBase64 } from '@mysten/sui/utils';
import { isValidTransactionSignature } from '@mysten/sui/verify';
import bs58 from 'bs58';
import { z } from 'zod';
import { errorMessage } from './json.js';
import type { SigningService } from './service.js';
import { decodeSolanaWire } from '../shared/solana-wire.js';
import {
  requestStatusSchema,
  signatureResultSchema,
  type TransactionRequest,
} from '../shared/schema.js';

const apiCompletionSchema = signatureResultSchema.omit({ completedAt: true });

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isLoopbackHost(rawHost: string | undefined): boolean {
  if (!rawHost) return false;
  try {
    const hostname = new URL(`http://${rawHost}`).hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export function isAllowedUiHost(
  rawHost: string | undefined,
  publicHost?: string,
): boolean {
  if (isLoopbackHost(rawHost)) return true;
  if (!rawHost || !publicHost) return false;
  try {
    return new URL(`http://${rawHost}`).hostname.toLowerCase() === publicHost.toLowerCase();
  } catch {
    return false;
  }
}

export function isValidUiToken(expected: string, authorization: string | undefined): boolean {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  return Boolean(token) && secureEqual(token, expected);
}

function requireAllowedHost(service: SigningService) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const rawHost = request.headers.host;
    if (!rawHost) {
      response.status(400).json({ error: 'Missing Host header' });
      return;
    }
    if (!isAllowedUiHost(rawHost, service.config.publicHost)) {
      response.status(403).json({ error: 'Host header rejected' });
      return;
    }
    next();
  };
}

function requireUiToken(service: SigningService) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!isValidUiToken(service.uiToken, request.header('authorization'))) {
      response.status(401).json({ error: 'Invalid or missing UI token' });
      return;
    }
    next();
  };
}

function normalizeSigner(request: TransactionRequest, address: string): string {
  if (request.chain === 'evm') return address.toLowerCase();
  if (request.chain === 'sui') return normalizeSuiAddress(address);
  return address;
}

export function validateCompletion(
  request: TransactionRequest,
  result: z.infer<typeof apiCompletionSchema>,
): Promise<void> {
  return validateCompletionAsync(request, result);
}

async function validateCompletionAsync(
  request: TransactionRequest,
  result: z.infer<typeof apiCompletionSchema>,
): Promise<void> {
  if (
    request.expectedSigner &&
    normalizeSigner(request, request.expectedSigner) !== normalizeSigner(request, result.walletAddress)
  ) {
    throw new Error(
      `Connected wallet ${result.walletAddress} does not match expected signer ${request.expectedSigner}`,
    );
  }

  if (request.mode === 'sign') {
    if (request.chain === 'evm' && !result.signedTransactionHex) {
      throw new Error('EVM sign-only completion requires signedTransactionHex');
    }
    if (
      request.chain === 'evm' &&
      !/^0x(?:[0-9a-fA-F]{2})+$/.test(result.signedTransactionHex!)
    ) {
      throw new Error('Invalid signed EVM transaction hex');
    }
    if (request.chain === 'solana' && !result.signedTransactionBase64) {
      throw new Error('Solana sign-only completion requires signed transaction bytes');
    }
    if (request.chain === 'solana') {
      decodeSolanaWire(Buffer.from(result.signedTransactionBase64!, 'base64'));
    }
    if (request.chain === 'sui' && (!result.signedTransactionBase64 || !result.signature)) {
      throw new Error('Sui sign-only completion requires signed bytes and a signature');
    }
  } else if (request.chain === 'evm' || request.chain === 'sui') {
    if (!result.transactionHash) {
      throw new Error(`${request.chain} sign-and-submit completion requires a transaction hash`);
    }
  } else if (!result.signature && !result.transactionHash) {
    throw new Error('Solana sign-and-submit completion requires a signature');
  }

  if (
    request.chain === 'evm' &&
    request.mode === 'sign-and-submit' &&
    !/^0x[0-9a-fA-F]{64}$/.test(result.transactionHash!)
  ) {
    throw new Error('Invalid EVM transaction hash');
  }

  if (request.chain === 'solana' && request.mode === 'sign-and-submit') {
    let signature: Uint8Array;
    try {
      signature = bs58.decode(result.signature ?? result.transactionHash!);
    } catch {
      throw new Error('Invalid base58 Solana transaction signature');
    }
    if (signature.byteLength !== 64) {
      throw new Error('Invalid Solana transaction signature length');
    }
  }

  if (request.chain === 'sui') {
    if (!result.signedTransactionBase64 || !result.signature) {
      throw new Error('Sui completion requires signed transaction bytes and a signature');
    }
    if (request.mode === 'sign-and-submit') {
      try {
        if (bs58.decode(result.transactionHash!).byteLength !== 32) throw new Error();
      } catch {
        throw new Error('Invalid Sui transaction digest');
      }
    }
    const valid = await isValidTransactionSignature(
      fromBase64(result.signedTransactionBase64),
      result.signature,
      { address: result.walletAddress },
    );
    if (!valid) throw new Error('Invalid Sui transaction signature for the connected wallet');
  }
}

export function createHttpApp(service: SigningService): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requireAllowedHost(service));
  app.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
    );
    next();
  });
  app.use('/api', express.json({ limit: '1mb', strict: true }), requireUiToken(service));

  app.get('/api/requests', async (request, response, next) => {
    try {
      const statuses = request.query.status;
      const rawFilter = Array.isArray(statuses)
        ? statuses.map(String)
        : typeof statuses === 'string'
          ? [statuses]
          : undefined;
      const filter = rawFilter ? z.array(requestStatusSchema).parse(rawFilter) : undefined;
      response.json({ requests: filter ? await service.list(filter) : await service.list() });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/requests/:id', async (request, response, next) => {
    try {
      const item = await service.get(request.params.id!);
      if (!item) {
        response.status(404).json({ error: 'Transaction request not found' });
        return;
      }
      response.json({ request: item });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/requests/:id/complete', async (request, response, next) => {
    try {
      const item = await service.get(request.params.id!);
      if (!item) {
        response.status(404).json({ error: 'Transaction request not found' });
        return;
      }
      const completion = apiCompletionSchema.parse(request.body);
      await validateCompletion(item, completion);
      const updated = await service.complete(item.id, {
        ...completion,
        completedAt: new Date().toISOString(),
      });
      response.json({ request: updated });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/requests/:id/reject', async (request, response, next) => {
    try {
      response.json({ request: await service.reject(request.params.id!) });
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(service.config.webDirectory, { index: false, fallthrough: true }));
  app.get(/^(?!\/api\/).*/, async (_request, response, next) => {
    try {
      const indexPath = path.join(service.config.webDirectory, 'index.html');
      if (!existsSync(indexPath)) {
        response
          .status(503)
          .type('text/plain')
          .send('SSIG browser app is not built. Run: npm run build');
        return;
      }
      response.type('html').send(await readFile(indexPath, 'utf8'));
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({ error: 'Invalid request', issues: error.issues });
      return;
    }
    const message = errorMessage(error);
    const status = /already|not found|does not match|requires|invalid/i.test(message) ? 409 : 500;
    response.status(status).json({ error: message });
  });

  return app;
}

export async function startHttpServer(service: SigningService): Promise<{
  server: Server;
  baseUrl: string;
  port: number;
}> {
  const app = createHttpApp(service);
  const server = await new Promise<Server>((resolve, reject) => {
    const candidate = app.listen(
      service.config.port,
      service.config.host,
      (error?: Error) => (error ? reject(error) : resolve(candidate)),
    );
    candidate.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine HTTP port');
  const advertisedHost = service.config.publicHost ?? service.config.host;
  const displayHost = advertisedHost === '::1' ? '[::1]' : advertisedHost;
  const baseUrl = `http://${displayHost}:${address.port}`;
  service.setBaseUrl(baseUrl);
  return { server, baseUrl, port: address.port };
}
