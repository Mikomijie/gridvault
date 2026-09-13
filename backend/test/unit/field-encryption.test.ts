import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EncryptionIntegrityError,
  FieldCrypto
} from '../../src/crypto/field-encryption.js';

const TEST_KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');
const PATIENT_X = 'patient-x-uuid-0001';
const PATIENT_Y = 'patient-y-uuid-0002';

function makeCrypto(): FieldCrypto {
  return new FieldCrypto(TEST_KEY);
}

describe('field encryption', () => {
  it('field crypto fails closed on a short master key and empty AAD inputs', () => {
    expect(() => new FieldCrypto(Buffer.alloc(31, 1))).toThrowError(EncryptionIntegrityError);
    expect(() => new FieldCrypto(Buffer.alloc(0))).toThrowError(EncryptionIntegrityError);
    const crypto = makeCrypto();
    expect(() => crypto.encryptField('', 'hiv_status', 'x')).toThrowError(EncryptionIntegrityError);
    expect(() => crypto.encryptField(PATIENT_X, '', 'x')).toThrowError(EncryptionIntegrityError);
  });
  it('AT-003: encrypt-decrypt round-trips every sensitive field, including empty string and 10KB text', () => {
    const crypto = makeCrypto();
    const fields: Array<[string, string]> = [
      ['hiv_status', 'Reactive (Confirmed)'],
      ['genotype', 'Hb SS'],
      ['pregnancy_status', 'Pregnant - G2 P1, 28 weeks gestation'],
      ['mental_health_notes', 'Situational anxiety post-trauma; nightmares since RTA.'],
      ['hiv_status', ''],
      ['clinical_note', 'a'.repeat(10240)],
      ['clinical_note', 'Unicode mix: héllo Økafor 😷  na-egbu mgbu! ' + 'x'.repeat(9000)]
    ];
    for (const [column, plaintext] of fields) {
      const payload = crypto.encryptField(PATIENT_X, column, plaintext, 1);
      expect(crypto.decryptField(PATIENT_X, column, payload)).toBe(plaintext);
    }
  });

  it('AT-004: ciphertext for the same plaintext differs across writes (random IV)', () => {
    const crypto = makeCrypto();
    const payloads = new Set<string>();
    for (let i = 0; i < 10; i++) {
      payloads.add(crypto.encryptField(PATIENT_X, 'hiv_status', 'Reactive (Confirmed)', 1));
    }
    expect(payloads.size).toBe(10);
  });

  it('AT-005: decrypting Patient X hiv_status_enc under Patient Y patient_id throws with no plaintext', () => {
    const crypto = makeCrypto();
    const payload = crypto.encryptField(PATIENT_X, 'hiv_status', 'Reactive (Confirmed)', 1);
    try {
      crypto.decryptField(PATIENT_Y, 'hiv_status', payload);
      expect.unreachable('decrypt under the wrong patient_id must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EncryptionIntegrityError);
      expect(String(error)).not.toContain('Reactive (Confirmed)');
    }
  });

  it('AT-006: decrypting under a mismatched column_name or key_version AAD throws', () => {
    const crypto = makeCrypto();
    const payload = crypto.encryptField(PATIENT_X, 'hiv_status', 'Reactive (Confirmed)', 1);
    expect(() => crypto.decryptField(PATIENT_X, 'genotype', payload)).toThrowError(
      EncryptionIntegrityError
    );
    expect(() => crypto.decryptField(PATIENT_X, 'hiv_status', payload, 2)).toThrowError(
      EncryptionIntegrityError
    );
  });

  it('AT-007: flipping one bit of ciphertext or tag throws and never returns garbage', () => {
    const crypto = makeCrypto();
    const payload = crypto.encryptField(PATIENT_X, 'genotype', 'Hb SS', 1);
    const parts = payload.split(':');
    const flipFirstByte = (b64: string): string => {
      const bytes = Buffer.from(b64, 'base64');
      bytes[0] = (bytes[0] as number) ^ 0x01;
      return bytes.toString('base64');
    };
    const corruptedCt = `${parts[0]}:${parts[1]}:${flipFirstByte(parts[2] as string)}:${parts[3]}`;
    const corruptedTag = `${parts[0]}:${parts[1]}:${parts[2]}:${flipFirstByte(parts[3] as string)}`;
    for (const corrupted of [corruptedCt, corruptedTag]) {
      try {
        const result = crypto.decryptField(PATIENT_X, 'genotype', corrupted);
        expect.unreachable(`corrupted payload must throw, got: ${result}`);
      } catch (error) {
        expect(error).toBeInstanceOf(EncryptionIntegrityError);
      }
    }
    // Wrong key entirely: authentication fails, never garbage.
    const otherKey = new FieldCrypto(randomBytes(32));
    expect(() => otherKey.decryptField(PATIENT_X, 'genotype', payload)).toThrowError(
      EncryptionIntegrityError
    );
    // Truncated IV and garbage payloads fail closed on format, not on crypto.
    const shortIv = `v1:${Buffer.alloc(4).toString('base64')}:${parts[2]}:${parts[3]}`;
    expect(() => crypto.decryptField(PATIENT_X, 'genotype', shortIv)).toThrowError(
      EncryptionIntegrityError
    );
    expect(() => crypto.decryptField(PATIENT_X, 'genotype', 'not-a-payload')).toThrowError(
      EncryptionIntegrityError
    );
    expect(() => crypto.decryptField(PATIENT_X, 'genotype', '')).toThrowError(
      EncryptionIntegrityError
    );
  });
});
