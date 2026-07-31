import {
  signatureResultSchema,
  transactionRequestListSchema,
  transactionRequestSchema,
  type SignatureResult,
  type TransactionRequest,
} from '../shared/schema';

const TOKEN_KEY = 'ssig-ui-token';

function loadToken(): string {
  const url = new URL(window.location.href);
  const incomingToken = url.searchParams.get('token');
  if (incomingToken) {
    sessionStorage.setItem(TOKEN_KEY, incomingToken);
    url.searchParams.delete('token');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    return incomingToken;
  }
  return sessionStorage.getItem(TOKEN_KEY) ?? '';
}

const token = loadToken();

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (!token) throw new Error('Missing UI token. Open the approval URL returned by the MCP tool.');
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  const body = (await response.json()) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export async function listRequests(): Promise<TransactionRequest[]> {
  const body = await api<{ requests: unknown }>('/api/requests');
  return transactionRequestListSchema.parse(body.requests);
}

export async function completeRequest(
  requestId: string,
  result: Omit<SignatureResult, 'completedAt'>,
): Promise<TransactionRequest> {
  const body = await api<{ request: unknown }>(`/api/requests/${requestId}/complete`, {
    method: 'POST',
    body: JSON.stringify(signatureResultSchema.omit({ completedAt: true }).parse(result)),
  });
  return transactionRequestSchema.parse(body.request);
}

export async function rejectRequest(requestId: string): Promise<TransactionRequest> {
  const body = await api<{ request: unknown }>(`/api/requests/${requestId}/reject`, {
    method: 'POST',
    body: '{}',
  });
  return transactionRequestSchema.parse(body.request);
}
