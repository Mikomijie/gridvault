// GridVault in-process metrics (PRD 14.7).
//
// Counters are best-effort in-process; the endpoint always exists. Rendered
// as Prometheus text at GET /api/health/metrics:
// - request rate + latency histograms per route
// - policy denials by reason_code
// - break-glass count, abuse alerts by rule
// - sync queue depth (pending outbox), anchor lag, chain verification result

export interface MetricsSnapshot {
  requests_total: Map<string, number>;
  request_latency_ms: Map<string, number[]>;
  denials_by_reason: Map<string, number>;
  break_glass_total: number;
  alerts_by_rule: Map<string, number>;
  last_verify_ms: number | null;
  last_verify_status: string | null;
}

const snapshot: MetricsSnapshot = {
  requests_total: new Map(),
  request_latency_ms: new Map(),
  denials_by_reason: new Map(),
  break_glass_total: 0,
  alerts_by_rule: new Map(),
  last_verify_ms: null,
  last_verify_status: null
};

function routeKey(method: string, route: string): string {
  return `${method} ${route}`;
}

export function recordRequest(method: string, route: string, durationMs: number): void {
  const key = routeKey(method, route);
  snapshot.requests_total.set(key, (snapshot.requests_total.get(key) ?? 0) + 1);
  const lat = snapshot.request_latency_ms.get(key) ?? [];
  lat.push(durationMs);
  if (lat.length > 1000) lat.shift();
  snapshot.request_latency_ms.set(key, lat);
}

export function recordDenial(reasonCode: string): void {
  snapshot.denials_by_reason.set(reasonCode, (snapshot.denials_by_reason.get(reasonCode) ?? 0) + 1);
}

export function recordBreakGlass(): void {
  snapshot.break_glass_total += 1;
}

export function recordAlert(rule: string): void {
  snapshot.alerts_by_rule.set(rule, (snapshot.alerts_by_rule.get(rule) ?? 0) + 1);
}

export function recordVerification(durationMs: number, status: string): void {
  snapshot.last_verify_ms = durationMs;
  snapshot.last_verify_status = status;
}

export function resetMetrics(): void {
  snapshot.requests_total.clear();
  snapshot.request_latency_ms.clear();
  snapshot.denials_by_reason.clear();
  snapshot.break_glass_total = 0;
  snapshot.alerts_by_rule.clear();
  snapshot.last_verify_ms = null;
  snapshot.last_verify_status = null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] as number;
}

/** Render the Prometheus exposition for /api/health/metrics. */
export function renderMetrics(options: {
  pendingOutbox?: number;
  anchorLagMinutes?: number | null;
} = {}): string {
  const lines: string[] = [];
  lines.push('# HELP gridvault_up Whether the node is serving.');
  lines.push('# TYPE gridvault_up gauge');
  lines.push('gridvault_up 1');
  lines.push('# HELP gridvault_requests_total Requests per route.');
  lines.push('# TYPE gridvault_requests_total counter');
  for (const [route, count] of snapshot.requests_total) {
    lines.push(`gridvault_requests_total{route="${route}"} ${count}`);
  }
  lines.push('# HELP gridvault_request_latency_p95_ms p95 latency per route.');
  lines.push('# TYPE gridvault_request_latency_p95_ms gauge');
  for (const [route, lat] of snapshot.request_latency_ms) {
    const sorted = [...lat].sort((a, b) => a - b);
    lines.push(`gridvault_request_latency_p95_ms{route="${route}"} ${percentile(sorted, 95).toFixed(1)}`);
  }
  lines.push('# HELP gridvault_policy_denials_total Denials by reason_code.');
  lines.push('# TYPE gridvault_policy_denials_total counter');
  for (const [reason, count] of snapshot.denials_by_reason) {
    lines.push(`gridvault_policy_denials_total{reason_code="${reason}"} ${count}`);
  }
  lines.push('# HELP gridvault_break_glass_total Emergency grants issued.');
  lines.push('# TYPE gridvault_break_glass_total counter');
  lines.push(`gridvault_break_glass_total ${snapshot.break_glass_total}`);
  lines.push('# HELP gridvault_abuse_alerts_total Alerts by rule.');
  lines.push('# TYPE gridvault_abuse_alerts_total counter');
  for (const [rule, count] of snapshot.alerts_by_rule) {
    lines.push(`gridvault_abuse_alerts_total{rule="${rule}"} ${count}`);
  }
  if (snapshot.last_verify_ms !== null) {
    lines.push('# HELP gridvault_chain_verify_duration_ms Last verification duration.');
    lines.push('# TYPE gridvault_chain_verify_duration_ms gauge');
    lines.push(`gridvault_chain_verify_duration_ms ${snapshot.last_verify_ms}`);
    lines.push('# HELP gridvault_chain_verify_status Last verification status (1=HEALTHY).');
    lines.push('# TYPE gridvault_chain_verify_status gauge');
    lines.push(`gridvault_chain_verify_status{status="${snapshot.last_verify_status ?? 'unknown'}"} ${(snapshot.last_verify_status ?? '') === 'HEALTHY' ? 1 : 0}`);
  }
  if (options.pendingOutbox !== undefined) {
    lines.push('# HELP gridvault_sync_queue_depth Pending outbox rows.');
    lines.push('# TYPE gridvault_sync_queue_depth gauge');
    lines.push(`gridvault_sync_queue_depth ${options.pendingOutbox}`);
  }
  if (options.anchorLagMinutes !== undefined && options.anchorLagMinutes !== null) {
    lines.push('# HELP gridvault_anchor_lag_minutes Minutes since last anchor.');
    lines.push('# TYPE gridvault_anchor_lag_minutes gauge');
    lines.push(`gridvault_anchor_lag_minutes ${options.anchorLagMinutes}`);
  }
  return lines.join('\n') + '\n';
}

export function metricsSnapshot(): MetricsSnapshot {
  return snapshot;
}
