import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  signatureResultSchema,
  transactionRequestListSchema,
  transactionRequestSchema,
  type RequestStatus,
  type SignatureResult,
  type Simulation,
  type TransactionInput,
  type TransactionRequest,
} from '../shared/schema.js';

type StoreFile = {
  version: 1;
  requests: TransactionRequest[];
};

const mutableStatuses = new Set<RequestStatus>(['pending']);

export class RequestStore {
  readonly #filePath: string;
  readonly #requestLimit: number;
  readonly #requests = new Map<string, TransactionRequest>();
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string, requestLimit = 1_000) {
    this.#filePath = filePath;
    this.#requestLimit = requestLimit;
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true, mode: 0o700 });
    try {
      const raw = await readFile(this.#filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) {
        throw new Error('Unsupported request store format');
      }
      const requests = transactionRequestListSchema.parse(
        (parsed as { requests?: unknown }).requests,
      );
      for (const request of requests) this.#requests.set(request.id, request);
      await this.#expireRequests();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.#persist();
    }
  }

  async create(input: TransactionInput, simulation: Simulation): Promise<TransactionRequest> {
    const now = new Date();
    const { expiresInMinutes, ...requestInput } = input;
    const request = transactionRequestSchema.parse({
      ...requestInput,
      id: randomUUID(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + expiresInMinutes * 60_000).toISOString(),
      status: 'pending',
      simulation,
    });

    this.#requests.set(request.id, request);
    this.#prune();
    await this.#persist();
    return request;
  }

  async get(id: string): Promise<TransactionRequest | undefined> {
    await this.#expireRequests();
    return this.#requests.get(id);
  }

  async list(statuses?: RequestStatus[]): Promise<TransactionRequest[]> {
    await this.#expireRequests();
    const statusFilter = statuses ? new Set(statuses) : undefined;
    return [...this.#requests.values()]
      .filter((request) => !statusFilter || statusFilter.has(request.status))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async complete(id: string, resultInput: SignatureResult): Promise<TransactionRequest> {
    const result = signatureResultSchema.parse(resultInput);
    return this.#transition(id, (request) => ({
      ...request,
      status: request.mode === 'sign' ? 'approved' : 'submitted',
      result,
    }));
  }

  async reject(id: string): Promise<TransactionRequest> {
    return this.#transition(id, (request) => ({ ...request, status: 'rejected' }));
  }

  async cancel(id: string): Promise<TransactionRequest> {
    return this.#transition(id, (request) => ({ ...request, status: 'canceled' }));
  }

  async fail(id: string, message: string): Promise<TransactionRequest> {
    return this.#transition(id, (request) => ({
      ...request,
      status: 'failed',
      error: message.slice(0, 2_000),
    }));
  }

  async #transition(
    id: string,
    update: (request: TransactionRequest) => TransactionRequest,
  ): Promise<TransactionRequest> {
    await this.#expireRequests();
    const current = this.#requests.get(id);
    if (!current) throw new Error(`Transaction request ${id} was not found`);
    if (!mutableStatuses.has(current.status)) {
      throw new Error(`Transaction request ${id} is already ${current.status}`);
    }
    const next = transactionRequestSchema.parse(update(current));
    this.#requests.set(id, next);
    await this.#persist();
    return next;
  }

  async #expireRequests(): Promise<void> {
    const now = Date.now();
    let changed = false;
    for (const [id, request] of this.#requests) {
      if (request.status === 'pending' && Date.parse(request.expiresAt) <= now) {
        this.#requests.set(
          id,
          transactionRequestSchema.parse({ ...request, status: 'expired' }),
        );
        changed = true;
      }
    }
    if (changed) await this.#persist();
  }

  #prune(): void {
    if (this.#requests.size <= this.#requestLimit) return;
    const removable = [...this.#requests.values()]
      .filter((request) => request.status !== 'pending')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    while (this.#requests.size > this.#requestLimit) {
      const request = removable.shift();
      if (!request) break;
      this.#requests.delete(request.id);
    }
  }

  async #persist(): Promise<void> {
    const operation = async () => {
      const output: StoreFile = { version: 1, requests: [...this.#requests.values()] };
      const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, this.#filePath);
      await chmod(this.#filePath, 0o600);
    };
    this.#writeQueue = this.#writeQueue.then(operation, operation);
    await this.#writeQueue;
  }
}
