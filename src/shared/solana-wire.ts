class WireReader {
  offset = 0;

  constructor(readonly bytes: Uint8Array) {}

  readByte(): number {
    const value = this.bytes[this.offset];
    if (value === undefined) throw new Error('Unexpected end of Solana transaction');
    this.offset += 1;
    return value;
  }

  readBytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length) {
      throw new Error('Invalid length in Solana transaction');
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readShortVectorLength(): number {
    let value = 0;
    let shift = 0;
    for (let index = 0; index < 5; index += 1) {
      const byte = this.readByte();
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
    }
    throw new Error('Oversized short-vector length in Solana transaction');
  }

  readByteVector(): number[] {
    return [...this.readBytes(this.readShortVectorLength())];
  }
}

function base58Encode(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  if (bytes.length === 0) return '';
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      const value = digits[index]! * 256 + carry;
      digits[index] = value % 58;
      carry = Math.floor(value / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let leading = '';
  let allZero = true;
  for (const byte of bytes) {
    if (byte !== 0) {
      allZero = false;
      break;
    }
    leading += alphabet[0];
  }
  if (allZero) return leading;
  return leading + digits.reverse().map((digit) => alphabet[digit]).join('');
}

export function decodeSolanaWire(bytes: Uint8Array): Record<string, unknown> {
  const reader = new WireReader(bytes);
  const signatureCount = reader.readShortVectorLength();
  reader.readBytes(signatureCount * 64);

  const versionMarker = reader.readByte();
  const versioned = (versionMarker & 0x80) !== 0;
  const version: 'legacy' | number = versioned ? versionMarker & 0x7f : 'legacy';
  if (versioned && version !== 0) {
    throw new Error(`Unsupported Solana transaction version ${version}`);
  }
  const requiredSignatures = versioned ? reader.readByte() : versionMarker;
  if (signatureCount !== requiredSignatures) {
    throw new Error(
      `Solana signature vector has ${signatureCount} entries but message requires ${requiredSignatures}`,
    );
  }
  const readonlySignedAccounts = reader.readByte();
  const readonlyUnsignedAccounts = reader.readByte();
  const accountCount = reader.readShortVectorLength();
  const staticAccounts = Array.from({ length: accountCount }, () =>
    base58Encode(reader.readBytes(32)),
  );
  const recentBlockhash = base58Encode(reader.readBytes(32));
  const instructionCount = reader.readShortVectorLength();
  const instructions = Array.from({ length: instructionCount }, (_, index) => ({
    index,
    programIdIndex: reader.readByte(),
    accountKeyIndexes: reader.readByteVector(),
    dataBase58: base58Encode(reader.readBytes(reader.readShortVectorLength())),
  }));

  const addressTableLookups = [];
  if (versioned) {
    const lookupCount = reader.readShortVectorLength();
    for (let index = 0; index < lookupCount; index += 1) {
      addressTableLookups.push({
        accountKey: base58Encode(reader.readBytes(32)),
        writableIndexes: reader.readByteVector(),
        readonlyIndexes: reader.readByteVector(),
      });
    }
  }
  if (reader.offset !== bytes.length) {
    throw new Error(`Unexpected ${bytes.length - reader.offset} trailing transaction bytes`);
  }

  return {
    byteLength: bytes.byteLength,
    signatureCount,
    version,
    header: { requiredSignatures, readonlySignedAccounts, readonlyUnsignedAccounts },
    recentBlockhash,
    staticAccounts,
    instructions,
    ...(versioned ? { addressTableLookups } : {}),
  };
}
