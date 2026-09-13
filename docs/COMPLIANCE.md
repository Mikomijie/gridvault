# GridVault Compliance Matrix (NDPA 2023 & NDPR 2019)

This document establishes the precise boundary between controls implemented in GridVault software, controls designed for operational deployment, and facility-owned responsibilities under the **Nigeria Data Protection Act (NDPA) 2023** and **NDPR 2019**.

---

## 1. Implemented Technical Controls (Software Layer)

| Requirement / Principle            | NDPA Reference | GridVault Implementation                                                                                                              | Verification Test       |
| :--------------------------------- | :------------- | :------------------------------------------------------------------------------------------------------------------------------------ | :---------------------- |
| Purpose Limitation                 | NDPA §24(1)(b) | Policy engine (`policy.decide()`) enforcing role, ward, duty, and admissions queue constraints.                                       | AT-101 … AT-114         |
| Data Minimisation                  | NDPA §24(1)(c) | Serialization boundary field redaction with `[RESTRICTED]` replacement; `_meta.redactions` audit trail.                               | AT-103, AT-116          |
| Sensitive Personal Data Safeguards | NDPA §30       | AES-256-GCM column encryption with row-binding AAD (`patient_id:column:key_version`) for HIV, genotype, pregnancy, psychiatric notes. | AT-003 … AT-007         |
| Tamper-Evident Access Logs         | NDPA §24(1)(f) | SHA-256 forward-linked cryptographic hash chain, append-only SQLite triggers, domain separation `gridvault.audit.v2`.                 | AT-010, AT-301 … AT-308 |
| External Accountability            | NDPA §39       | Ed25519 signed anchor receipts dispatched to independent external witness node (`witness:9090`).                                      | AT-310, AT-311          |
| Insider Threat Detection           | NDPA §40       | Synchronous abuse detection engine (`RULE-ABUSE-01` through `RULE-ABUSE-09`) blocking illicit queries.                                | AT-401 … AT-409         |
| Subject Access Request (SAR)       | NDPA §34       | CLI tool `npm run gv -- subject-access --patient <id>` extracting chronological verifiable access history.                            | AT-912                  |

---

## 2. Designed Operational Controls (Deployment Layer)

| Control Area               | Specification                                                                                                       | Responsible Role        | Operational Status                                    |
| :------------------------- | :------------------------------------------------------------------------------------------------------------------ | :---------------------- | :---------------------------------------------------- |
| External Witness Custody   | Host witness service on physically or organizationally independent infrastructure (e.g., State Ministry of Health). | Hospital IT / State DPO | Reference container provided in `docker-compose.yml`. |
| Local Backup Durability    | 4-hourly `VACUUM INTO` snapshots with SHA-256 manifests and tested restore drills.                                  | System Administrator    | Automated via `scripts/restore-drill.sh`.             |
| Physical Terminal Security | Ward terminal idle timeout (180s) and memory purge hard-lock (900s).                                                | Ward In-Charge          | Client-side timer and backdrop-blur overlay.          |
| Key Management & Rotation  | Master key loaded via secure environment variable with zero git exposure; versioned DEK rotation.                   | Security Officer        | Versioned ciphertext schema implemented.              |

---

## 3. Facility-Owned Responsibilities (Governance Layer)

GridVault does NOT replace institutional data governance. The healthcare facility must independently:

1. **Appoint a Data Protection Officer (DPO):** Designated individual responsible for monitoring compliance and liaising with the Nigeria Data Protection Commission (NDPC).
2. **Conduct Data Protection Impact Assessments (DPIA):** Formal assessments prior to deploying digital systems in high-stigma clinical wards.
3. **Staff Training & Credential Integrity:** Mandatory training prohibiting credential sharing, enforcing individual PIN management and secure logout.
4. **Physical Security:** Lockable ward cabinets for offline triage slips, physical security of edge mini-PCs and uninterrupted power supplies (UPS).
