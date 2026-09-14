// GridVault column-level field encryption (PRD section 11.1).
//
// AES-256-GCM with a 96-bit random IV per write and a 128-bit auth tag.
// Wire format: v<key_version>:<iv_b64>:<ciphertext_b64>:<tag_b64>
// AAD = patient_id || ':' || column_name || ':' || key_version, so
// ciphertext moved to another row, another column, or another key version
// fails authentication instead of decrypting into the wrong chart.
//
// Key hierarchy: GRIDVAULT_MASTER_KEY (32 bytes) -> HKDF-SHA256 ->
// per-version data-encryption key. Decryption derives the DEK for the
// version named in the payload, so reads keep working across rotations.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export class EncryptionIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionIntegrityError';
  }
}

const MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KDF_SALT = 'gridvault-field-kdf-v1';

function kdfInfo(keyVersion: number): string {
  return `gridvault/field-dek/v${keyVersion}`;
}

const ENCRYPTED_PATTERN = /^v(\d+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]*):([A-Za-z0-9+/=]+)$/;

export class FieldCrypto {
  private readonly masterKey: Buffer;

  constructor(masterKey: Uint8Array) {
    if (masterKey.byteLength !== MASTER_KEY_BYTES) {
      throw new EncryptionIntegrityError(
        `Master key must be exactly ${MASTER_KEY_BYTES} bytes, got ${masterKey.byteLength}`
      );
    }
    this.masterKey = Buffer.from(masterKey);
  }

  private deriveDek(keyVersion: number): Buffer {
    if (!Number.isInteger(keyVersion) || keyVersion < 1) {
      throw new EncryptionIntegrityError(`Invalid key version: ${String(keyVersion)}`);
    }
    return Buffer.from(
      hkdfSync('sha256', this.masterKey, KDF_SALT, kdfInfo(keyVersion), MASTER_KEY_BYTES)
    );
  }

  private static aad(patientId: string, column: string, keyVersion: number): Buffer {
    return Buffer.from(`${patientId}:${column}:${keyVersion}`, 'utf8');
  }

  encryptField(patientId: string, column: string, plaintext: string, keyVersion = 1): string {
    if (patientId.length === 0 || column.length === 0) {
      throw new EncryptionIntegrityError('patient_id and column must be non-empty for AAD');
    }
    const dek = this.deriveDek(keyVersion);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    cipher.setAAD(FieldCrypto.aad(patientId, column, keyVersion));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    // getAuthTag() for AES-256-GCM without an explicit authTagLength always
    // returns 16 bytes; a length check here would be an untestable branch
    // (NFR-10). Tampering is caught on the decrypt path by GCM
    // authentication (AT-007).
    const tag = cipher.getAuthTag();
    return (
      `v${keyVersion}:${iv.toString('base64')}:` +
      `${ciphertext.toString('base64')}:${tag.toString('base64')}`
    );
  }

  /**
   * Decrypt a payload produced by encryptField. Throws
   * EncryptionIntegrityError on any format error, AAD mismatch (wrong
   * patient, column or key version) or tag mismatch (bit flip / forgery).
   * Never returns garbage plaintext: GCM authentication is verified by the
   * runtime before any byte is released.
   */
  decryptField(
    patientId: string,
    column: string,
    payload: string,
    expectedKeyVersion?: number
  ): string {
    const match = ENCRYPTED_PATTERN.exec(payload);
    if (match === null) {
      throw new EncryptionIntegrityError('Malformed encrypted field payload');
    }
    const keyVersion = Number(match[1]);
    if (expectedKeyVersion !== undefined && keyVersion !== expectedKeyVersion) {
      throw new EncryptionIntegrityError(
        `Key version mismatch for column ${column}: payload is v${keyVersion}, expected v${expectedKeyVersion}`
      );
    }
    // Note: Buffer.from(..., 'base64') never throws on malformed input in
    // Node (invalid characters are skipped), so short/odd decodes are
    // caught by the explicit length check below, which fails closed.
    const iv = Buffer.from(match[2] as string, 'base64');
    const ciphertext = Buffer.from(match[3] as string, 'base64');
    const tag = Buffer.from(match[4] as string, 'base64');
    if (iv.byteLength !== IV_BYTES || tag.byteLength !== TAG_BYTES) {
      throw new EncryptionIntegrityError(`Invalid IV or tag length for column ${column}`);
    }
    try {
      const dek = this.deriveDek(keyVersion);
      const decipher = createDecipheriv('aes-256-gcm', dek, iv);
      decipher.setAAD(FieldCrypto.aad(patientId, column, keyVersion));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new EncryptionIntegrityError(
        `Authentication failed decrypting column ${column}: wrong patient, column, key version or corrupted ciphertext`
      );
    }
  }
}
