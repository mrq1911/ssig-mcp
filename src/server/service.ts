import { randomBytes } from 'node:crypto';
import { bcs } from '@mysten/sui/bcs';
import { fromBase64 } from '@mysten/sui/utils';
import type { AppConfig } from './config.js';
import { simulateTransaction } from './simulator.js';
import { RequestStore } from './store.js';
import { decodeSolanaWire } from '../shared/solana-wire.js';
import type {
  RequestStatus,
  SignatureResult,
  Simulation,
  TransactionInput,
  TransactionRequest,
} from '../shared/schema.js';

export class SigningService {
  readonly config: AppConfig;
  readonly store: RequestStore;
  readonly uiToken: string;
  #baseUrl = '';

  constructor(config: AppConfig, store = new RequestStore(config.dataFile, config.requestLimit)) {
    this.config = config;
    this.store = store;
    this.uiToken = randomBytes(32).toString('base64url');
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  setBaseUrl(baseUrl: string): void {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
  }

  approvalUrl(id?: string): string {
    if (!this.#baseUrl) throw new Error('HTTP approval server has not started');
    const query = new URLSearchParams({ token: this.uiToken });
    if (id) query.set('request', id);
    return `${this.#baseUrl}/?${query.toString()}`;
  }

  async simulate(input: TransactionInput): Promise<Simulation> {
    return simulateTransaction(input, this.config);
  }

  async create(input: TransactionInput): Promise<TransactionRequest> {
    if (input.chain === 'solana') {
      decodeSolanaWire(Buffer.from(input.transactionBase64, 'base64'));
    } else if (input.chain === 'sui') {
      try {
        bcs.TransactionData.parse(fromBase64(input.transactionBase64));
      } catch (error) {
        throw new Error(
          `Invalid BCS Sui TransactionData: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const simulation = await this.simulate(input);
    if (
      this.config.requireSimulation &&
      (simulation.status === 'unavailable' || simulation.status === 'error')
    ) {
      throw new Error(`A successful simulation is required: ${simulation.summary}`);
    }
    if (this.config.blockFailedSimulation && simulation.status === 'failed') {
      throw new Error(`Simulation failed; request was not queued: ${simulation.summary}`);
    }
    return this.store.create(input, simulation);
  }

  get(id: string): Promise<TransactionRequest | undefined> {
    return this.store.get(id);
  }

  list(statuses?: RequestStatus[]): Promise<TransactionRequest[]> {
    return this.store.list(statuses);
  }

  complete(id: string, result: SignatureResult): Promise<TransactionRequest> {
    return this.store.complete(id, result);
  }

  reject(id: string): Promise<TransactionRequest> {
    return this.store.reject(id);
  }

  cancel(id: string): Promise<TransactionRequest> {
    return this.store.cancel(id);
  }

  fail(id: string, message: string): Promise<TransactionRequest> {
    return this.store.fail(id, message);
  }
}
