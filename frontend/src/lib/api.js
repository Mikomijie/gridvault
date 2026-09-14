// GridVault API client (P8). Single HTTP boundary for the ward terminal.
//
// - Tokens live in memory only; the refresh cookie is HttpOnly and handled
//   by the browser. No PHI or credential ever touches localStorage or
//   sessionStorage (AT-627).
// - 401 responses trigger one silent refresh-and-retry so form input is
//   never lost to token expiry (AT-621).
// - Errors normalize to { code, message, reason_code, details,
//   can_break_glass } per PRD 12.1; rejection bodies never echo values.

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080').replace(/\/+$/, '');

let accessToken = null;
let refreshInFlight = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function clearAccessToken() {
  accessToken = null;
  refreshInFlight = null;
}

export function getAccessToken() {
  return accessToken;
}

async function refreshToken() {
  if (refreshInFlight === null) {
    refreshInFlight = fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include'
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('refresh failed');
        const body = await res.json();
        accessToken = body.data.access_token;
        return accessToken;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export class ApiError extends Error {
  constructor({ status, code, message, reasonCode, details, canBreakGlass }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.reasonCode = reasonCode;
    this.details = details ?? {};
    this.canBreakGlass = canBreakGlass ?? false;
  }
}

function toApiError(status, body) {
  const err = body?.error ?? {};
  return new ApiError({
    status,
    code: err.code ?? 'UNKNOWN',
    message: err.message ?? 'Request failed',
    reasonCode: err.reason_code ?? null,
    details: err.details ?? {},
    canBreakGlass: err.can_break_glass ?? false
  });
}

export async function apiFetch(path, { method = 'GET', body, auth = true, retried = false } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth && accessToken !== null) headers.authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status === 401 && auth && !retried) {
    try {
      await refreshToken();
    } catch {
      throw toApiError(res.status, await res.json().catch(() => ({})));
    }
    return apiFetch(path, { method, body, auth, retried: true });
  }
  if (res.status === 204) return null;
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw toApiError(res.status, payload);
  return payload;
}

export const api = {
  login: (staffId, password) =>
    apiFetch('/api/auth/login', { method: 'POST', auth: false, body: { staff_id: staffId, password } }),
  logout: () => apiFetch('/api/auth/logout', { method: 'POST' }),
  me: () => apiFetch('/api/auth/me'),
  unlock: (pin) => apiFetch('/api/auth/unlock', { method: 'POST', body: { pin } }),
  roster: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/api/patients${query.length > 0 ? `?${query}` : ''}`);
  },
  dossier: (hospitalNumber) => apiFetch(`/api/patients/${encodeURIComponent(hospitalNumber)}`),
  recordVitals: (hospitalNumber, vitals) =>
    apiFetch(`/api/patients/${encodeURIComponent(hospitalNumber)}/vitals`, { method: 'POST', body: vitals }),
  overrideExecute: (input) => apiFetch('/api/override/execute', { method: 'POST', body: input }),
  overrideActive: () => apiFetch('/api/override/active'),
  syncBatch: (mutations) => apiFetch('/api/sync/batch', { method: 'POST', body: { mutations } }),
  syncBackfill: (slips) => apiFetch('/api/sync/backfill', { method: 'POST', body: { slips } }),
  overrideClose: (id) => apiFetch(`/api/override/${encodeURIComponent(id)}/close`, { method: 'POST' }),
  auditVerify: () => apiFetch('/api/audit/verify'),
  abuseAlerts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiFetch(`/api/abuse/alerts${query.length > 0 ? `?${query}` : ''}`);
  }
};
