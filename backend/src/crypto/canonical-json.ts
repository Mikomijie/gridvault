// GridVault canonical JSON (PRD section 8.3).
//
// Deterministic serialization for hash-chained payloads: object keys sorted
// lexicographically, pure-ASCII output, numbers per ECMA-262
// Number::toString. Rejects NaN, Infinity, undefined, BigInt and circular
// references with a typed error instead of silently producing null or
// throwing a generic TypeError.

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

function escapeString(value: string): string {
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0) as number;
    if (ch === '"') {
      out += '\\"';
    } else if (ch === '\\') {
      out += '\\\\';
    } else if (code === 0x08) {
      out += '\\b';
    } else if (code === 0x09) {
      out += '\\t';
    } else if (code === 0x0a) {
      out += '\\n';
    } else if (code === 0x0c) {
      out += '\\f';
    } else if (code === 0x0d) {
      out += '\\r';
    } else if (code < 0x20 || code > 0x7e) {
      if (code > 0xffff) {
        const high = Math.floor((code - 0x10000) / 0x400) + 0xd800;
        const low = ((code - 0x10000) % 0x400) + 0xdc00;
        out += `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`;
      } else {
        out += `\\u${code.toString(16).padStart(4, '0')}`;
      }
    } else {
      out += ch;
    }
  }
  out += '"';
  return out;
}

function encode(value: unknown, ancestors: Set<object>): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    throw new CanonicalJsonError('undefined is not representable in canonical JSON');
  }
  const kind = typeof value;
  if (kind === 'string') {
    return escapeString(value as string);
  }
  if (kind === 'number') {
    const num = value as number;
    if (!Number.isFinite(num)) {
      throw new CanonicalJsonError(`Non-finite number is not representable: ${String(value)}`);
    }
    return String(num);
  }
  if (kind === 'boolean') {
    return value === true ? 'true' : 'false';
  }
  if (kind === 'bigint') {
    throw new CanonicalJsonError('bigint is not representable in canonical JSON');
  }
  if (kind === 'function' || kind === 'symbol') {
    throw new CanonicalJsonError(`${kind} is not representable in canonical JSON`);
  }

  const obj = value as Record<string, unknown>;
  if (ancestors.has(obj)) {
    throw new CanonicalJsonError('Circular reference detected in canonical JSON input');
  }
  ancestors.add(obj);
  try {
    if (Array.isArray(obj)) {
      const items = obj.map((item) => encode(item, ancestors));
      return `[${items.join(',')}]`;
    }
    const keys = Object.keys(obj).sort();
    const parts = keys.map((key) => `${escapeString(key)}:${encode(obj[key], ancestors)}`);
    return `{${parts.join(',')}}`;
  } finally {
    ancestors.delete(obj);
  }
}

/**
 * Serialize `value` to deterministic, pure-ASCII JSON.
 * Key order, escaping and number formatting are fixed, so the same logical
 * value always produces byte-identical output regardless of insertion order.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, new Set<object>());
}
