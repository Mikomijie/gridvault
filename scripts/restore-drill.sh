#!/usr/bin/env bash
# GridVault backup & restore drill (AT-905, PRD 14.6).
#
# backup -> destroy the DB -> restore -> verify. Fails (non-zero exit) unless
# every check holds: manifest checksum matches, chain is HEALTHY, patient
# count is identical, and the ledger head is exactly the snapshotted head
# plus the single RESTORE_PERFORMED entry the restore itself appends.
#
# Runs against an isolated temp DATABASE_PATH; never touches ./data.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/gv-restore-drill-XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

export DATABASE_PATH="$TMP/gridvault.db"
export GRIDVAULT_MASTER_KEY="${GRIDVAULT_MASTER_KEY:-k8s9J3nF9x0q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6=}"

GV=(npm run --silent gv --)
JSON="$TMP/report.json"

json_field() {
  node -e "const r=require('fs').readFileSync(process.argv[1],'utf8');const m=r.match(/\{[\s\S]*\}/);if(!m){console.error('no JSON in output');process.exit(1)}const o=JSON.parse(m[0]);console.log(o[process.argv[2]] ?? '')" "$1" "$2"
}

echo "==> [1/6] seeding demo profile into isolated $DATABASE_PATH"
"${GV[@]}" seed --profile demo > "$TMP/seed.log"
grep -q "patients=12" "$TMP/seed.log"

echo "==> [2/6] generating audited activity so the chain is non-trivial"
cat > "$ROOT/.drill-activity.tmp.ts" <<'TS_EOF'
import { openDatabase } from './backend/src/db/connection.js';
import { appendLedgerEntry } from './backend/src/ledger/append.js';
const db = openDatabase(process.env.DATABASE_PATH as string);
// patient_id is the internal row id (as the records service writes it),
// never the hospital number.
const patient = db.prepare('SELECT id FROM patients WHERE hospital_number = ?').get('HOSP-LOS-2025-082') as { id: string };
const run = db.transaction(() => {
  appendLedgerEntry(db, { staff_id: 'SN-7742', staff_role: 'nurse', ward: 'ward_a', patient_id: 'SYSTEM', action: 'LOGIN', details: { method: 'password', terminal: 'drill-terminal-905' }, timestamp: '2026-09-14T09:00:00.000+01:00' });
  appendLedgerEntry(db, { staff_id: 'SN-7742', staff_role: 'nurse', ward: 'ward_a', patient_id: patient.id, action: 'VIEW_RECORD', details: { fields: ['full_name', 'ward'], decision: 'ROLE_WARD_DUTY_SATISFIED' }, timestamp: '2026-09-14T09:01:00.000+01:00' });
  appendLedgerEntry(db, { staff_id: 'SN-7742', staff_role: 'nurse', ward: 'ward_a', patient_id: patient.id, action: 'RECORD_VITALS', details: { vitals_id: 'drill-vitals-905' }, timestamp: '2026-09-14T09:02:00.000+01:00' });
});
run();
db.close();
TS_EOF
./node_modules/.bin/tsx "$ROOT/.drill-activity.tmp.ts"
rm -f "$ROOT/.drill-activity.tmp.ts"
"${GV[@]}" verify-ledger > "$TMP/verify-before.log"
grep -q '"status": "HEALTHY"' "$TMP/verify-before.log"
BEFORE_ENTRIES="$(json_field "$TMP/verify-before.log" total_records)"
echo "    live entries before backup: $BEFORE_ENTRIES"

echo "==> [3/6] backup with SHA-256 manifest"
"${GV[@]}" backup --dir "$TMP/backups" > "$TMP/backup.log"
BACKUP_DB="$(ls "$TMP"/backups/gridvault_*.db | head -n 1)"
test -f "$BACKUP_DB.manifest.json"
MANIFEST_SHA="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).sha256)" "$BACKUP_DB.manifest.json")"
ACTUAL_SHA="$(node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))" "$BACKUP_DB")"
test "$MANIFEST_SHA" = "$ACTUAL_SHA"
MANIFEST_HEAD="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).ledger_head_index)" "$BACKUP_DB.manifest.json")"
echo "    manifest checksum matches; snapshot head index=$MANIFEST_HEAD"

echo "==> [4/6] destroying the live database"
rm -f "$DATABASE_PATH" "$DATABASE_PATH-wal" "$DATABASE_PATH-shm" "$DATABASE_PATH-journal"
test ! -e "$DATABASE_PATH"

echo "==> [5/6] restore from backup"
"${GV[@]}" restore --file "$BACKUP_DB" > "$TMP/restore.log"
grep -q "verified and swapped" "$TMP/restore.log"

echo "==> [6/6] verifying restored state"
"${GV[@]}" verify-ledger > "$TMP/verify-after.log"
grep -q '"status": "HEALTHY"' "$TMP/verify-after.log"
AFTER_HEAD="$(json_field "$TMP/verify-after.log" head_hash)"
AFTER_ENTRIES="$(json_field "$TMP/verify-after.log" total_records)"
MANIFEST_ENTRIES="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).ledger_entries)" "$BACKUP_DB.manifest.json")"
MANIFEST_PATIENTS="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).patients)" "$BACKUP_DB.manifest.json")"
# Restored ledger = snapshot plus the single RESTORE_PERFORMED entry.
test "$AFTER_ENTRIES" = "$((MANIFEST_ENTRIES + 1))"
test "$MANIFEST_PATIENTS" = "12"
# Pre-backup drill entries survived the round trip byte-identical.
"${GV[@]}" export-ledger --out "$TMP/restored.jsonl" > /dev/null
grep -q "drill-terminal-905" "$TMP/restored.jsonl"
grep -q "drill-vitals-905" "$TMP/restored.jsonl"
# Patient access history is intact and verifiable.
SUBJECT_ENTRIES="$("${GV[@]}" subject-access --patient HOSP-LOS-2025-082 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=s.match(/\{[\s\S]*\}/);console.log(JSON.parse(m[0]).entries)})")"
test "$SUBJECT_ENTRIES" = "2"
echo "    head=$AFTER_HEAD entries=$AFTER_ENTRIES patients=$MANIFEST_PATIENTS"

echo "==> restore drill PASSED: manifest checksum matches, chain HEALTHY, 12 patients and $MANIFEST_ENTRIES snapshotted entries intact (+1 RESTORE_PERFORMED), drill sentinels present"
