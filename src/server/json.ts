const MAX_DEPTH = 12;

export function toJsonSafe(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[maximum depth reached]';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return undefined;
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((entry) => toJsonSafe(entry, depth + 1));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const safeEntry = toJsonSafe(entry, depth + 1);
      if (safeEntry !== undefined) output[key] = safeEntry;
    }
    return output;
  }
  return String(value);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
