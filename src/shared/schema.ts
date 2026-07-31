import { z } from 'zod';

const asciiOnly = /^[\x09\x0a\x0d\x20-\x7e]+$/;
const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const dataHex = /^0x(?:[0-9a-fA-F]{2})*$/;
const quantityHex = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const evmAddress = /^0x[0-9a-fA-F]{40}$/;
const suiAddress = /^0x[0-9a-fA-F]{1,64}$/;

export const requestStatusSchema = z.enum([
  'pending',
  'approved',
  'submitted',
  'rejected',
  'failed',
  'expired',
  'canceled',
]);

export const signingModeSchema = z.enum(['sign', 'sign-and-submit']);

export const asciiExplanationSchema = z
  .string()
  .min(40, 'ASCII explanation must contain at least 40 characters')
  .max(4_000)
  .regex(asciiOnly, 'Explanation must contain ASCII characters only')
  .refine((value) => value.includes('\n'), 'ASCII explanation must use multiple lines')
  .refine((value) => /[A-Za-z0-9]/.test(value), 'ASCII explanation must contain meaningful text');

const commonInputFields = {
  title: z.string().trim().min(3).max(120),
  asciiExplanation: asciiExplanationSchema.describe(
    'Required plain-ASCII explanation of what the transaction does. Use a small ASCII diagram or table, name assets/amounts/recipients, and state the expected outcome and main risk.',
  ),
  expectedSigner: z.string().trim().min(1).max(128).optional(),
  mode: signingModeSchema,
  expiresInMinutes: z.number().int().min(1).max(24 * 60).default(15),
};

export const evmTransactionSchema = z
  .object({
    to: z.string().regex(evmAddress).optional(),
    data: z.string().regex(dataHex).default('0x'),
    value: z.string().regex(quantityHex).optional(),
    gas: z.string().regex(quantityHex).optional(),
    gasPrice: z.string().regex(quantityHex).optional(),
    maxFeePerGas: z.string().regex(quantityHex).optional(),
    maxPriorityFeePerGas: z.string().regex(quantityHex).optional(),
    nonce: z.string().regex(quantityHex).optional(),
    accessList: z
      .array(
        z
          .object({
            address: z.string().regex(evmAddress),
            storageKeys: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)).max(1_024),
          })
          .strict(),
      )
      .max(1_024)
      .optional(),
  })
  .strict()
  .refine((transaction) => transaction.to !== undefined || transaction.data !== '0x', {
    message: 'A contract creation must include non-empty data',
  })
  .refine(
    (transaction) =>
      !transaction.gasPrice ||
      (!transaction.maxFeePerGas && !transaction.maxPriorityFeePerGas),
    { message: 'gasPrice cannot be combined with EIP-1559 fee fields' },
  );

export const evmRequestInputSchema = z
  .object({
    chain: z.literal('evm').default('evm'),
    ...commonInputFields,
    chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    networkName: z.string().trim().min(1).max(80).optional(),
    transaction: evmTransactionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.expectedSigner && !evmAddress.test(value.expectedSigner)) {
      context.addIssue({
        code: 'custom',
        path: ['expectedSigner'],
        message: 'Expected EVM signer must be a 20-byte 0x address',
      });
    }
  });

export const solanaNetworkSchema = z.enum([
  'solana:mainnet',
  'solana:devnet',
  'solana:testnet',
  'solana:localnet',
]);

const serializedTransactionSchema = z
  .string()
  .min(4)
  .max(400_000)
  .refine((value) => value.length % 4 === 0 && base64.test(value), 'Invalid base64 transaction');

export const solanaRequestInputSchema = z
  .object({
    chain: z.literal('solana').default('solana'),
    ...commonInputFields,
    network: solanaNetworkSchema,
    transactionBase64: serializedTransactionSchema.describe(
      'Base64-encoded, unsigned or partially signed Solana wire transaction',
    ),
  })
  .strict();

export const suiNetworkSchema = z.enum([
  'sui:mainnet',
  'sui:testnet',
  'sui:devnet',
  'sui:localnet',
]);

export const suiRequestInputSchema = z
  .object({
    chain: z.literal('sui').default('sui'),
    ...commonInputFields,
    network: suiNetworkSchema,
    transactionBase64: serializedTransactionSchema.describe(
      'Base64-encoded BCS Sui TransactionData bytes',
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.expectedSigner && !suiAddress.test(value.expectedSigner)) {
      context.addIssue({
        code: 'custom',
        path: ['expectedSigner'],
        message: 'Expected Sui signer must be a 0x-prefixed address',
      });
    }
  });

export const transactionInputSchema = z.discriminatedUnion('chain', [
  evmRequestInputSchema,
  solanaRequestInputSchema,
  suiRequestInputSchema,
]);

export const simulationSchema = z
  .object({
    status: z.enum(['success', 'failed', 'unavailable', 'error']),
    provider: z.string().min(1).max(80),
    performedAt: z.string().datetime(),
    summary: z.string().min(1).max(1_000),
    details: z.unknown().optional(),
  })
  .strict();

export const signatureResultSchema = z
  .object({
    walletAddress: z.string().min(1).max(128),
    completedAt: z.string().datetime(),
    transactionHash: z.string().max(256).optional(),
    signature: z.string().max(400_000).optional(),
    signedTransactionBase64: z.string().max(400_000).optional(),
    signedTransactionHex: z.string().max(800_002).optional(),
  })
  .strict();

const persistedCommonFields = {
  id: z.string().uuid(),
  title: z.string(),
  asciiExplanation: asciiExplanationSchema,
  expectedSigner: z.string().optional(),
  mode: signingModeSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  status: requestStatusSchema,
  simulation: simulationSchema,
  result: signatureResultSchema.optional(),
  error: z.string().max(2_000).optional(),
};

export const evmRequestSchema = z
  .object({
    ...persistedCommonFields,
    chain: z.literal('evm'),
    chainId: z.number().int().positive(),
    networkName: z.string().optional(),
    transaction: evmTransactionSchema,
  })
  .strict();

export const solanaRequestSchema = z
  .object({
    ...persistedCommonFields,
    chain: z.literal('solana'),
    network: solanaNetworkSchema,
    transactionBase64: serializedTransactionSchema,
  })
  .strict();

export const suiRequestSchema = z
  .object({
    ...persistedCommonFields,
    chain: z.literal('sui'),
    network: suiNetworkSchema,
    transactionBase64: serializedTransactionSchema,
  })
  .strict();

export const transactionRequestSchema = z.discriminatedUnion('chain', [
  evmRequestSchema,
  solanaRequestSchema,
  suiRequestSchema,
]);

export const transactionRequestListSchema = z.array(transactionRequestSchema);

export type RequestStatus = z.infer<typeof requestStatusSchema>;
export type SigningMode = z.infer<typeof signingModeSchema>;
export type EvmTransaction = z.infer<typeof evmTransactionSchema>;
export type EvmRequestInput = z.infer<typeof evmRequestInputSchema>;
export type SolanaRequestInput = z.infer<typeof solanaRequestInputSchema>;
export type SuiRequestInput = z.infer<typeof suiRequestInputSchema>;
export type TransactionInput = z.infer<typeof transactionInputSchema>;
export type Simulation = z.infer<typeof simulationSchema>;
export type SignatureResult = z.infer<typeof signatureResultSchema>;
export type TransactionRequest = z.infer<typeof transactionRequestSchema>;

export function isTerminalStatus(status: RequestStatus): boolean {
  return status !== 'pending';
}
