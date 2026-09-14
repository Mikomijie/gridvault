// GridVault password and PIN hashing (PRD 6.6).
//
// Argon2id, memory 64 MiB, time cost 3, parallelism 4. The parameters ride
// inside the encoded hash, so verify() needs no options. Quick-PINs (4-6
// digits, break-glass confirmation and idle-lock resume only) use the same
// parameters and are never accepted as a primary login factor — enforced by
// the service layer, which exposes no password-shaped PIN path.

import argon2 from 'argon2';

export const ARGON_MEMORY_KIB = 65536;
export const ARGON_TIME_COST = 3;
export const ARGON_PARALLELISM = 4;

export async function hashSecret(value: string): Promise<string> {
  return argon2.hash(value, {
    type: argon2.argon2id,
    memoryCost: ARGON_MEMORY_KIB,
    timeCost: ARGON_TIME_COST,
    parallelism: ARGON_PARALLELISM
  });
}

export async function verifySecret(hash: string, value: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, value);
  } catch {
    // Malformed stored hash or verification failure: indistinguishable from
    // a wrong secret to the caller. Never throws.
    return false;
  }
}
