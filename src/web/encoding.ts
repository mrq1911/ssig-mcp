export function fromBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function toBase64(value: Uint8Array): string {
  let binary = '';
  const chunkSize = 32_768;
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    binary += String.fromCharCode(...value.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

export function shorten(value: string, edge = 8): string {
  return value.length <= edge * 2 + 3 ? value : `${value.slice(0, edge)}...${value.slice(-edge)}`;
}

export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return toBase64(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]),
    );
  }
  return value;
}
