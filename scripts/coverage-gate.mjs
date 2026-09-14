#!/usr/bin/env node
// NFR-10 per-path gate: 100% branch coverage on policy/, ledger/ and
// crypto/. Vitest only supports global thresholds, so `npm run
// test:coverage` runs this right after the global 85% gate. Reads the
// v8 json report (coverage/coverage-final.json). Exits non-zero naming
// every file below the bar.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const GATED_PREFIXES = ['backend/src/policy/', 'backend/src/ledger/', 'backend/src/crypto/'];
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const reportPath = path.join(ROOT, 'coverage', 'coverage-final.json');

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error(`coverage-gate: cannot read ${reportPath} (run vitest with --coverage first): ${String(error)}`);
  process.exit(2);
}

const failures = [];
for (const [file, data] of Object.entries(report)) {
  const relative = path.relative(ROOT, file);
  if (!GATED_PREFIXES.some((prefix) => relative.startsWith(prefix))) continue;
  const branches = data.branchMap ?? {};
  const taken = data.b ?? {};
  let total = 0;
  let covered = 0;
  for (const [id, counts] of Object.entries(taken)) {
    if (!Array.isArray(counts) || branches[id]?.type === 'default-arg') continue;
    for (const count of counts) {
      total += 1;
      if (count > 0) covered += 1;
    }
  }
  if (total > 0 && covered < total) {
    failures.push(`${relative}: branch ${covered}/${total}`);
  }
}

if (failures.length > 0) {
  console.error('coverage-gate: NFR-10 100%-branch gate FAILED for:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log('coverage-gate: 100% branch on policy/, ledger/, crypto/ — PASS');
