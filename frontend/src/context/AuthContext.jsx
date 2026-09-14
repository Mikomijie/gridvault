import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearAccessToken, setAccessToken } from '../lib/api.js';
import en from '../i18n/en.json';

const AuthContext = createContext(null);

/**
 * AuthProvider (P8). Authorization context — role, ward, shift, duty —
 * comes exclusively from GET /api/auth/me, i.e. the server-side user
 * record. The client never chooses its own ward or shift (that was the v1
 * vulnerability). Tokens live in memory; nothing persists to storage.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [dutyState, setDutyState] = useState(null);
  const [activeGrants, setActiveGrants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refreshMe = useCallback(async () => {
    const me = await api.me();
    setUser(me.data.user);
    setDutyState(me.data.duty_state ?? me.data.user?.duty_state ?? null);
    setActiveGrants(me.data.active_grants ?? []);
    return me.data;
  }, []);

  // One-shot session restore for guarded routes. Deliberately NOT run on
  // public boot: the refresh cookie is HttpOnly so absence is indistinguishable
  // without a network round trip, and browsers log its 401 to the console —
  // the landing page must stay console-clean (AT-601). Lazy refresh on the
  // first authenticated call (api.js) covers the rest (AT-621).
  const restoreSession = useCallback(async () => {
    try {
      const res = await fetch(
        `${(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080').replace(/\/+$/, '')}/api/auth/refresh`,
        { method: 'POST', credentials: 'include' }
      );
      if (!res.ok) return false;
      const body = await res.json();
      setAccessToken(body.data.access_token);
      await refreshMe();
      return true;
    } catch {
      return false;
    }
  }, [refreshMe]);

  useEffect(() => {
    setLoading(false);
  }, []);

  const login = useCallback(
    async (staffId, password) => {
      setError(null);
      try {
        const res = await api.login(staffId, password);
        setAccessToken(res.data.access_token);
        const me = await refreshMe();
        return me;
      } catch (err) {
        setError(err.message ?? en.login.errorGeneric);
        throw err;
      }
    },
    [refreshMe]
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Logout is best-effort over the wire; local state always clears.
    } finally {
      clearAccessToken();
      setUser(null);
      setDutyState(null);
      setActiveGrants([]);
    }
  }, []);

  const value = useMemo(
    () => ({ user, dutyState, activeGrants, loading, error, login, logout, refreshMe, restoreSession }),
    [user, dutyState, activeGrants, loading, error, login, logout, refreshMe, restoreSession]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
