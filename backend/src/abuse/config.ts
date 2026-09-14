// GridVault abuse-rule threshold configuration (PRD 9.2).
//
// Thresholds live in `config/abuse-rules.json` so a facility can tune them
// without a redeploy. The file is validated by Zod at boot and a bad value
// fails startup loudly rather than silently disabling a rule (AT-409).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

const abuseRulesSchema = z.object({
  off_ward_escalation_count: z.number().int().min(2).max(20),
  off_ward_escalation_window_minutes: z.number().int().min(1).max(1440),
  bulk_read_distinct_5min: z.number().int().min(2).max(1000),
  bulk_read_distinct_60min: z.number().int().min(2).max(10000),
  bulk_read_critical_multiplier: z.number().int().min(1).max(10),
  bulk_throttle_per_second: z.number().int().min(1).max(100),
  sensitive_sweep_distinct_patients: z.number().int().min(2).max(100),
  sensitive_sweep_window_minutes: z.number().int().min(1).max(1440),
  sensitive_block_minutes: z.number().int().min(1).max(1440),
  login_failures_threshold: z.number().int().min(2).max(100),
  login_failures_window_minutes: z.number().int().min(1).max(1440),
  break_glass_frequency_count: z.number().int().min(2).max(20),
  break_glass_frequency_window_minutes: z.number().int().min(1).max(1440)
});

export type AbuseRuleThresholds = z.infer<typeof abuseRulesSchema>;

function defaultAbuseRulesPath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'config',
    'abuse-rules.json'
  );
}

/**
 * Load and validate the abuse-rule thresholds. Throws a named Error that the
 * bootstrap turns into a startup refusal (AT-409): the node never runs with
 * a rule silently disabled.
 */
export function loadAbuseRules(filePath: string = defaultAbuseRulesPath()): AbuseRuleThresholds {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`abuse-rules config unreadable: ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`abuse-rules config is not valid JSON: ${filePath}`);
  }
  const result = abuseRulesSchema.safeParse(parsed);
  if (!result.success) {
    const names = result.error.issues
      .map((issue) => (issue.path.length > 0 ? String(issue.path[0]) : 'config'))
      .join(', ');
    throw new Error(
      `abuse-rules config invalid (${filePath}): thresholds [${names}] failed validation: ` +
        result.error.issues.map((issue) => issue.message).join('; ')
    );
  }
  return result.data;
}
