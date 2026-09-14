import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { api, setAccessToken } from '../lib/api.js';
import en from '../i18n/en.json';

const IDLE_LOCK_SECONDS = Number(import.meta.env.VITE_IDLE_LOCK_SECONDS ?? 180);
const HARD_LOCK_SECONDS = Number(import.meta.env.VITE_HARD_LOCK_SECONDS ?? 900);

const LockContext = createContext(null);

/**
 * LockProvider (PRD 13.3, AT-115). After IDLE_LOCK_SECONDS without input
 * the terminal locks: an opaque overlay replaces all clinical content (PHI
 * leaves the DOM entirely — a blur over readable text is not a redaction)
 * and a PIN resumes the session. After HARD_LOCK_SECONDS the session is
 * purged from memory and the user returns to /login.
 */
export function LockProvider({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [unlocking, setUnlocking] = useState(false);
  const lastActivity = useRef(Date.now());
  const lockedRef = useRef(false);
  lockedRef.current = locked;

  const touch = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    if (user === null) {
      setLocked(false);
      return undefined;
    }
    lastActivity.current = Date.now();
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    for (const name of events) window.addEventListener(name, onActivity, { passive: true });
    const timer = setInterval(() => {
      const idleMs = Date.now() - lastActivity.current;
      if (idleMs >= HARD_LOCK_SECONDS * 1000) {
        logout()
          .catch(() => undefined)
          .finally(() => navigate('/login', { replace: true }));
      } else if (idleMs >= IDLE_LOCK_SECONDS * 1000 && !lockedRef.current) {
        setLocked(true);
      }
    }, 1000);
    return () => {
      for (const name of events) window.removeEventListener(name, onActivity);
      clearInterval(timer);
    };
  }, [user, logout, navigate]);

  const unlock = useCallback(async () => {
    setError(null);
    setUnlocking(true);
    try {
      const res = await api.unlock(pin);
      setAccessToken(res.data.access_token);
      lastActivity.current = Date.now();
      setPin('');
      setLocked(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setUnlocking(false);
    }
  }, [pin]);

  const value = useMemo(() => ({ locked, touch }), [locked, touch]);
  return (
    <LockContext.Provider value={value}>
      {locked && user !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#131b2e] p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              unlock().catch(() => undefined);
            }}
            className="w-full max-w-sm rounded-xl bg-white p-6"
            aria-label={en.lock.title}
          >
            <h1 className="text-[18px] font-bold">{en.lock.title}</h1>
            <p className="mt-1 text-[13px] text-[#404752]">{en.lock.body}</p>
            <label className="mt-4 block text-[12px] font-bold" htmlFor="lock-pin">
              {en.lock.pinLabel}
            </label>
            <input
              id="lock-pin"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="off"
              className="mt-1 h-10 w-full rounded-lg bg-[#f2f3ff] px-3 text-[14px]"
            />
            {error && (
              <p role="alert" className="mt-2 rounded-lg bg-[#ffdad6] px-3 py-2 text-[13px] font-bold text-[#93000a]">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={unlocking || pin.trim().length === 0}
              className="mt-4 w-full rounded-lg bg-[#005ea4] py-2.5 text-[14px] font-bold text-white disabled:opacity-60"
            >
              {en.lock.unlock}
            </button>
          </form>
        </div>
      ) : (
        children
      )}
    </LockContext.Provider>
  );
}

export function useLock() {
  const ctx = useContext(LockContext);
  if (ctx === null) throw new Error('useLock must be used inside LockProvider');
  return ctx;
}
