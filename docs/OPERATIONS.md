# GridVault Operational Runbook

## 1. Deployment Topology

GridVault is designed for zero-cloud resilience in Nigerian healthcare environments:

- **Ward Edge Node:** Runs on an onsite mini-PC or Raspberry Pi 4 with battery backup (UPS). Hosts nginx reverse proxy (`:8443` / `:8000`), Node.js backend (`:8080`), and SQLite WAL database.
- **Witness Node:** Independent service deployed on separate hardware or network domain (`:9090`). Stores append-only anchor receipts under distinct credentials.
- **Client Terminals:** Desktops and tablets running evergreen web browsers (Chrome, Edge, Firefox, Safari) with Service Worker and encrypted IndexedDB.

---

## 2. Backup & Restore Procedures

### 2.1 Automated Backups

Automated hot backups run every 4 hours via SQLite `VACUUM INTO`:

```bash
npm run gv -- backup
```

This produces:

- `backups/gridvault_<ISO8601>.db`: Atomic, crash-consistent snapshot.
- `backups/gridvault_<ISO8601>.manifest.json`: Contains record counts, ledger head index, and SHA-256 checksum.

### 2.2 Restore Drill

To restore and verify database integrity:

```bash
npm run gv -- restore --file backups/gridvault_<ISO8601>.db
```

The restore procedure:

1. Validates the SHA-256 manifest.
2. Restores to a temporary staging file and runs integrity checks.
3. Verifies the audit hash chain against the external witness.
4. Atomically replaces the active database and appends a `RESTORE_PERFORMED` ledger entry.

---

## 3. Cryptographic Key Management & Rotation

### 3.1 Master Key Provisioning

- Provided via `GRIDVAULT_MASTER_KEY` (32 bytes base64 encoded).
- Must have file permissions `0400` if stored on disk.
- Boot fails in production if missing, shorter than 32 bytes, or set to the known default development key.

### 3.2 Field Key Rotation

```bash
npm run gv -- rotate-key
```

Re-encrypts all sensitive columns under `key_version + 1` in batches inside an immediate transaction, maintaining backwards readability during the transition.

---

## 4. Ledger Anchoring & Independent Audit

### 4.1 Periodic Witness Anchoring

The backend periodically submits signed anchor receipts to the witness service:

```bash
npm run gv -- anchor
```

### 4.2 Offline External Verification

To inspect and verify audit trail validity on an isolated machine:

```bash
npm run gv -- export-ledger --out /tmp/ledger.jsonl
npm run gv -- verify-ledger --file /tmp/ledger.jsonl
```

---

## 5. Security Incident Response Playbook

1. **Hash Chain Tampering (`TAMPERED` / `TRUNCATED`):**
   - Identify `broken_at_index` from `/api/audit/verify`.
   - Freeze write access and isolate database snapshot.
   - Cross-reference with external witness receipts to determine if local files were altered.
2. **Witness Divergence (`WITNESS_DIVERGED`):**
   - Immediate high-severity security escalation. Host root compromise suspected.
3. **Repeated Authentication Failures / Stuffing:**
   - Review `/api/abuse/alerts` for `RULE-ABUSE-08`. IP and staff lockouts engage automatically for 15 minutes.
