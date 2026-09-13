import { describe, expect, it } from 'vitest';
import { CanonicalJsonError, canonicalJson } from '../../src/crypto/canonical-json.js';

function shuffledKeys<T extends Record<string, unknown>>(obj: T): T {
  const keys = Object.keys(obj);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = keys[i] as string;
    const b = keys[j] as string;
    keys[i] = b as string;
    keys[j] = a as string;
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[key as string] = obj[key as string];
  }
  return out as T;
}

describe('canonical JSON', () => {
  it('AT-001: canonical JSON sorts keys, escapes non-ASCII, byte-identical across 1000 shuffled-key inputs', () => {
    // Hand-derived expectation: keys sorted, no whitespace.
    expect(canonicalJson({ b: 1, a: 'x' })).toBe('{"a":"x","b":1}');
    // Hand-derived control escapes: backspace, form feed, CR, tab,
    // backslash and DEL all have fixed ASCII spellings.
    expect(canonicalJson({ s: 'a\bb\fc\rd\te\\f\x7f' })).toBe(
      '{"s":"a\\bb\\fc\\rd\\te\\\\f\\u007f"}'
    );

    const record = {
      ward: 'ward_a',
      name: 'Amara Økafor 😷',
      nested: { zulu: [3, 2, 1], alpha: 'héllo "world"\nnewline' },
      count: 42,
      temp: 37.2,
      flag: true,
      nothing: null
    };
    const baseline = canonicalJson(record);
    // Pure ASCII: every byte below 128.
    for (const ch of baseline) {
      expect(ch.codePointAt(0) as number).toBeLessThan(128);
    }
    // Non-ASCII input never appears literally.
    expect(baseline).not.toContain('Ø');
    expect(baseline).not.toContain('😷');
    // Sorted keys at every level.
    expect(baseline.indexOf('"count"')).toBeLessThan(baseline.indexOf('"flag"'));
    expect(baseline.indexOf('"alpha"')).toBeLessThan(baseline.indexOf('"zulu"'));

    for (let i = 0; i < 1000; i++) {
      const shuffled = shuffledKeys(shuffledKeys(record));
      expect(canonicalJson(shuffled)).toBe(baseline);
    }
  });

  it('AT-002: canonical JSON rejects NaN, Infinity, undefined and circular refs', () => {
    expect(() => canonicalJson(Number.NaN)).toThrowError(CanonicalJsonError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrowError(CanonicalJsonError);
    expect(() => canonicalJson(Number.NEGATIVE_INFINITY)).toThrowError(CanonicalJsonError);
    expect(() => canonicalJson(undefined)).toThrowError(CanonicalJsonError);
    expect(() => canonicalJson({ a: undefined })).toThrowError(CanonicalJsonError);
    expect(() => canonicalJson({ a: Number.NaN })).toThrowError(CanonicalJsonError);
    expect(() => canonicalJson([1, Number.POSITIVE_INFINITY])).toThrowError(CanonicalJsonError);
    expect(() => canonicalJson(10n)).toThrowError(CanonicalJsonError);
    expect(() =>
      canonicalJson({ fn: () => 1 })
    ).toThrowError(CanonicalJsonError);
    expect(() => canonicalJson(Symbol('s'))).toThrowError(CanonicalJsonError);
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => canonicalJson(circular)).toThrowError(CanonicalJsonError);
    const loop: unknown[] = [1];
    loop.push(loop);
    expect(() => canonicalJson(loop)).toThrowError(CanonicalJsonError);
  });
});
