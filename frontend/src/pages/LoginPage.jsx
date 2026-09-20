import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import en from '../i18n/en.json';

const Icons = {
  verifiedUser: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 11l-4-4 1.41-1.41L10 9.17l6.59-6.59L18 4l-8 8z" />
    </svg>
  ),
  lockClock: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
    </svg>
  ),
  dns: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 13H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zm-2 5h-2v-2h2v2zm0-8H6c-.55 0-1-.45-1-1V4c0-.55.45-1 1-1h12c.55 0 1 .45 1 1v5c0 .55-.45 1-1 1zm-2-4h-2V8h2V6z" />
    </svg>
  ),
  hospital: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H8v-4H6v-2h2V9h4v2h2v2h-2v4zm5-8h-2V7h-2V5h2V3h2v2h2v2h-2v2z" />
    </svg>
  ),
  policy: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 4l5 2.18V11c0 3.5-2.33 6.79-5 7.93-2.67-1.14-5-4.43-5-7.93V7.18L12 5z" />
    </svg>
  ),
  terminal: (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-2h16v2zm0-4H4V6h16v8zM6.5 9l1.41 1.41L6.33 12l1.58 1.59L6.5 15l-3-3 3-3zm11 0l3 3-3 3-1.41-1.41L17.67 12l-1.58-1.59L17.5 9z" />
    </svg>
  ),
  lock: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
    </svg>
  ),
  visibilityOn: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
    </svg>
  ),
  visibilityOff: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" />
    </svg>
  ),
  spinner: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="animate-spin">
      <path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z" />
    </svg>
  ),
};

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState('success');
  const [currentTime, setCurrentTime] = useState('');
  const [formData, setFormData] = useState({
    staffId: '',
    password: ''
  });

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const s = String(now.getSeconds()).padStart(2, '0');
      setCurrentTime(`UTC+1 ${h}:${m}:${s} WAT`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await login(formData.staffId, formData.password);
      navigate('/dashboard');
    } catch (error) {
      setToastType('error');
      setToastMessage(error.message || 'Login failed');
      setTimeout(() => setToastMessage(''), 5000);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white antialiased flex flex-col justify-between">
      <main className="w-full flex-1 flex flex-col items-center justify-center p-4 md:p-6">
        <div className="w-full max-w-7xl mx-auto py-4 md:py-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 rounded-xl shadow-2xl overflow-hidden bg-slate-800">
            {/* LEFT COLUMN */}
            <div className="lg:col-span-5 relative flex flex-col justify-between p-6 md:p-10 bg-gradient-to-br from-slate-800 to-slate-900 overflow-hidden order-2 lg:order-1 border-r border-slate-700">
              <div
                className="absolute inset-0 opacity-30 mix-blend-screen pointer-events-none"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 10% 20%, rgba(16, 185, 129, 0.06) 0%, transparent 60%), radial-gradient(circle at 90% 80%, rgba(16, 185, 129, 0.04) 0%, transparent 50%)'
                }}
              ></div>

              {/* Brand */}
              <div className="relative z-10 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-emerald-600 rounded-lg flex items-center justify-center flex-shrink-0">
                      <span className="text-white font-bold text-base">G</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-semibold text-[18px] text-emerald-400 tracking-tight leading-none">
                        GridVault
                      </span>
                      <span className="text-[11px] font-bold tracking-[0.05em] text-slate-400 uppercase">
                        Clinical EMR
                      </span>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold tracking-[0.05em] uppercase">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    Live Vault
                  </span>
                </div>

                <div className="mt-1">
                  <p className="text-[18px] font-semibold text-emerald-300 tracking-tight">
                    GridVault EHR v4.8
                  </p>
                  <p className="text-[14px] text-slate-400 mt-1">
                    Clinical Integrity & Instant Patient Telemetry
                  </p>
                </div>

                {/* Compliance Badges */}
                <div className="flex flex-wrap gap-2 mt-1">
                  <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold tracking-[0.05em]">
                    <span className="text-emerald-400">{Icons.verifiedUser}</span>
                    NDPR Aligned
                  </div>
                  <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-700/50 border border-slate-600/50 text-slate-300 text-[11px] font-bold tracking-[0.05em]">
                    <span className="text-slate-400">{Icons.lockClock}</span>
                    ISO 27001
                  </div>
                  <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold tracking-[0.05em]">
                    <span className="text-emerald-400">{Icons.dns}</span>
                    Ward Edge Node
                  </div>
                </div>
              </div>

              {/* Clinical Image */}
              <div className="relative z-10 my-6 rounded-xl overflow-hidden shadow-lg bg-slate-700">
                <div className="relative h-56 md:h-64 w-full">
                  <img
                    className="w-full h-full object-cover object-center opacity-90"
                    src="/images/login-clinical.png"
                    alt="Nigerian healthcare professionals reviewing patient records"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent"></div>
                  <div className="absolute bottom-0 inset-x-0 p-4 text-slate-100">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-emerald-400">{Icons.hospital}</span>
                      <p className="text-[12px] font-bold tracking-[0.02em] text-emerald-300 uppercase">
                        St. Nicholas & Teaching Centers
                      </p>
                    </div>
                    <p className="text-[20px] font-semibold text-white leading-tight">
                      Ward-Synchronized Electronic Charts
                    </p>
                    <p className="text-[12px] text-slate-300 mt-1 line-clamp-2">
                      Real-time vital diagnostics, medication records, and role-enforced telemetry.
                    </p>
                  </div>
                </div>
              </div>

              {/* Role Security Callout */}
              <div className="relative z-10 p-4 rounded-lg bg-slate-700/50 border border-slate-600/50 flex items-start gap-3">
                <div className="p-2 rounded-md bg-emerald-600/30 text-emerald-300 flex-shrink-0">
                  {Icons.policy}
                </div>
                <div>
                  <h4 className="text-[14px] font-semibold text-white">
                    Role-Based Record Isolation
                  </h4>
                  <p className="text-[12px] text-slate-400 mt-0.5 leading-relaxed">
                    Your credential bundle provisions decryption keys for assigned ward beds. Unassigned patient dossiers remain cryptographically sealed.
                  </p>
                </div>
              </div>

              {/* Audit Stamp */}
              <div className="relative z-10 mt-4 pt-3 border-t border-slate-600/50 flex items-center justify-between text-[11px] font-bold text-slate-400">
                <span className="flex items-center gap-1">
                  <span className="text-slate-400">{Icons.terminal}</span>
                  Terminal Session:{' '}
                  <span className="font-mono text-emerald-300 ml-1">NG-LOS-0498</span>
                </span>
                <span>{currentTime}</span>
              </div>
            </div>

            {/* RIGHT COLUMN - FORM */}
            <div className="lg:col-span-7 relative flex flex-col justify-center p-6 md:p-12 order-1 lg:order-2">
              <div className="max-w-sm mx-auto w-full">
                {/* Header */}
                <div className="mb-8">
                  <h1 className="text-3xl font-bold text-white mb-2">Clinical Portal Access</h1>
                  <p className="text-slate-400">Select your role and enter credentials to proceed.</p>
                </div>

                {/* Form */}
                <form onSubmit={handleLogin} className="space-y-6">
                  {/* Staff ID */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-2">Staff ID</label>
                    <input
                      type="text"
                      value={formData.staffId}
                      onChange={(e) => setFormData({ ...formData, staffId: e.target.value })}
                      placeholder="e.g. SN-7742"
                      className="w-full px-4 py-3 rounded-lg bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                      disabled={isLoading}
                    />
                  </div>

                  {/* Password */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-2">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        placeholder="Enter password"
                        className="w-full px-4 py-3 rounded-lg bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                        disabled={isLoading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-3 text-slate-400 hover:text-emerald-400 transition-colors"
                      >
                        {showPassword ? Icons.visibilityOff : Icons.visibilityOn}
                      </button>
                    </div>
                  </div>

                  {/* Login Button */}
                  <button
                    type="submit"
                    disabled={isLoading || !formData.staffId || !formData.password}
                    className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
                  >
                    {isLoading && Icons.spinner}
                    {isLoading ? 'Authenticating...' : 'Access Clinical Portal'}
                  </button>
                </form>

                {/* Toast */}
                {toastMessage && (
                  <div className={`mt-4 p-4 rounded-lg text-sm font-medium ${
                    toastType === 'error' 
                      ? 'bg-red-500/20 border border-red-500/40 text-red-300' 
                      : 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                  }`}>
                    {toastMessage}
                  </div>
                )}

                {/* Demo Personas */}
                <div className="mt-10 p-4 rounded-lg bg-slate-700/30 border border-slate-600/50">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Demo Personas</p>
                  <div className="space-y-2 text-sm">
                    <div className="p-2 rounded bg-slate-700/50">
                      <p className="font-semibold text-emerald-300">Nurse: SN-7742</p>
                      <p className="text-slate-400 text-xs">Ward A • Morning shift</p>
                    </div>
                    <div className="p-2 rounded bg-slate-700/50">
                      <p className="font-semibold text-emerald-300">Doctor: GV-9042</p>
                      <p className="text-slate-400 text-xs">Ward 3 ICU • Trauma</p>
                    </div>
                    <div className="p-2 rounded bg-slate-700/50">
                      <p className="font-semibold text-emerald-300">Clerk: RC-1029</p>
                      <p className="text-slate-400 text-xs">Admissions • Records</p>
                    </div>
                    <div className="p-2 rounded bg-slate-700/50">
                      <p className="font-semibold text-emerald-300">Admin: AD-0012</p>
                      <p className="text-slate-400 text-xs">IT Ops • Lagos Hub</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-700/50 py-4 px-6 text-center text-xs text-slate-500">
        <p>GridVault v1.0.0 — Sovereign Clinical EMR for Nigerian Healthcare</p>
      </footer>
    </div>
  );
}