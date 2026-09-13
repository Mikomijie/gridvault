# GridVault Threat Model & Security Assurance

## 1. Protected Assets

- **A1. High-Stigma Clinical Attributes:** HIV serostatus, sickle-cell genotype (`Hb AA/AS/SS/SC`), pregnancy records, psychiatric and mental health notes.
- **A2. Complete Clinical Record:** Diagnoses, medication administration records (MAR), vitals trends, clinical notes.
- **A3. Audit Ledger Integrity:** Append-only timeline of all clinical access, grants, rejections, and abuse alerts.
- **A4. Clinical Availability at Bedside:** Uninterrupted ability to view active ward patients and chart observations during network or power collapse.
- **A5. Staff Credentials and Cryptographic Keys:** Argon2id password hashes, quick PIN hashes, JWT secrets, master key material.

---

## 2. Threat Matrix & Verified Defenses

| ID      | Adversary & Vector                     | Attacker Capability                                    | Target Asset | Enforced Control                                                                                                                              | Verification Test                       |
| :------ | :------------------------------------- | :----------------------------------------------------- | :----------- | :-------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------- |
| **T1**  | Curious Records Clerk                  | Valid low-privilege staff credentials                  | A1, A2       | Deny-by-default policy, field redaction at serializer, admissions queue check, and `RULE-ABUSE-01` blocking access and alerting.              | `AT-401`, `AT-103`, `AT-104`            |
| **T2**  | Off-Ward Clinician Snooping            | Authenticated doctor/nurse exploring off-ward records  | A1, A2       | Ward predicate denies access (`WARD_MISMATCH`) with `can_break_glass: true` and fires `RULE-ABUSE-02`. Zero clinical bytes in body.           | `AT-105`, `AT-110`, `AT-403`            |
| **T3**  | Off-Duty / Transferred Staff           | Valid credentials outside shift or after transfer      | A1, A2, A3   | Duty state calculation with 30m grace window, account status and expiration check, and `RULE-ABUSE-03`.                                       | `AT-020` … `AT-025`, `AT-404`           |
| **T4**  | Host Insider with DB File Access       | Read/write access to SQLite `.db` file                 | A3           | Append-only database triggers prevent `UPDATE`/`DELETE`; SHA-256 hash chain breaks on tampering; verifier flags `broken_at_index`.            | `AT-010`, `AT-011`, `AT-305` … `AT-308` |
| **T5**  | Root / Host Compromise (Full Takeover) | Owns host, application code, and database              | A3           | External witness node receives signed Ed25519 receipts. Recomputed chain diverges from witness receipt (`WITNESS_DIVERGED`).                  | `AT-309`, `AT-310`, `AT-311`            |
| **T6**  | Ransomware / Node Hardware Failure     | Edge node encrypted or physically destroyed            | A4           | 4-hourly automated `VACUUM INTO` backups, encrypted browser cache, paper emergency triage slips with batch backfill.                          | `AT-513`, `AT-514`, `AT-905`            |
| **T7**  | Unattended Terminal Snooping           | Physical access to logged-in ward tablet               | A1, A2       | 3-minute idle lock with frosted opaque overlay (removing PHI from DOM); 15-minute hard purge forcing complete re-login.                       | `AT-115`                                |
| **T8**  | Ciphertext-Swapping Attack             | Swapping encrypted fields between patient records      | A1           | AES-256-GCM authenticated encryption with AAD bound to `patient_id:column:key_version`. Decryption fails closed (`EncryptionIntegrityError`). | `AT-005`, `AT-006`, `AT-117`            |
| **T9**  | Break-Glass Habitual Abuse             | Clinician misusing emergency override for routine ease | A1, A2       | Single-patient scoped 60-min grant, mandatory reason code, automatic outbox dispatch to CMO and charge nurse, `RULE-ABUSE-04`.                | `AT-201` … `AT-212`, `AT-405`           |
| **T10** | Local Network Interception             | Attacker on hospital LAN or Wi-Fi                      | A1, A2, A5   | TLS 1.3 encryption, strict HSTS, secure HttpOnly SameSite=Strict refresh cookies, token replay defense.                                       | `AT-018`, `AT-019`, `AT-907`            |
