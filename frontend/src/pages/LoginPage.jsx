import React, { useState, useEffect } from 'react';

const Icons = {
  verifiedUser: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
    </svg>
  ),
  lockClock: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
    </svg>
  ),
  dns: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 13H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zm-2 5h-2v-2h2v2zm0-8H6c-.55 0-1-.45-1-1V4c0-.55.45-1 1-1h12c.55 0 1 .45 1 1v5c0 .55-.45 1-1 1zm-2-4h-2V8h2V6z"/>
    </svg>
  ),
  hospital: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H8v-4H6v-2h2V9h4v2h2v2h-2v4zm5-8h-2V7h-2V5h2V3h2v2h2v2h-2v2z"/>
    </svg>
  ),
  policy: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 4l5 2.18V11c0 3.5-2.33 6.79-5 7.93-2.67-1.14-5-4.43-5-7.93V7.18L12 5z"/>
    </svg>
  ),
  terminal: (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-2h16v2zm0-4H4V6h16v8zM6.5 9l1.41 1.41L6.33 12l1.58 1.59L6.5 15l-3-3 3-3zm11 0l3 3-3 3-1.41-1.41L17.67 12l-1.58-1.59L17.5 9z"/>
    </svg>
  ),
  key: (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.65 10A6 6 0 0 0 7 6a6 6 0 0 0-6 6 6 6 0 0 0 6 6 6 6 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
    </svg>
  ),
  badge: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 7h-5V4c0-1.1-.9-2-2-2h-2c-1.1 0-2 .9-2 2v3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm-7 0h-2V4h2v3z"/>
    </svg>
  ),
  lock: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
    </svg>
  ),
  visibilityOn: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
    </svg>
  ),
  visibilityOff: (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
    </svg>
  ),
  stethoscope: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 8c0-2.76-2.24-5-5-5H8C5.24 3 3 5.24 3 8v6c0 2.76 2.24 5 5 5h1v2h2v-2h2v2h2v-2h1c2.76 0 5-2.24 5-5v-1h-2v1c0 1.65-1.35 3-3 3H8c-1.65 0-3-1.35-3-3V8c0-1.65 1.35-3 3-3h6c1.65 0 3 1.35 3 3h2z"/>
    </svg>
  ),
  medicalServices: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 6h-2.18c.07-.44.18-.87.18-1.33C18 2.54 15.96.5 13.33.5c-1.4 0-2.66.58-3.56 1.5L9 2.83l-.77-.84C7.33 1.08 6.07.5 4.67.5 2.04.5 0 2.54 0 4.67c0 .46.11.89.18 1.33H0v14c0 1.1.9 2 2 2h20c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-5-3.5c1.11 0 2 .89 2 2s-.89 2-2 2-2-.89-2-2 .89-2 2-2zM9 4.17c0-1.11.89-2 2-2s2 .89 2 2-.89 2-2 2-2-.89-2-2zM4.67 3c1.11 0 2 .89 2 2s-.89 2-2 2-2-.89-2-2 .89-2 2-2zM18 18H6v-2h12v2zm0-4H6v-2h12v2z"/>
    </svg>
  ),
  folderShared: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-5 3c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm4 8h-8v-1c0-1.33 2.67-2 4-2s4 .67 4 2v1z"/>
    </svg>
  ),
  manageAccounts: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 18v-.65c0-.34.16-.66.41-.86C6.1 15.26 8.12 14.5 10 14.5s3.9.76 5.59 2c.25.2.41.52.41.86V18H4zm6-6c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm7.75-.85l1.45 1.27-.72 1.24-1.74-.76c-.27.22-.58.39-.91.5L15.5 15h-1.5l-.33-1.6c-.33-.11-.64-.28-.91-.5l-1.74.76-.72-1.24 1.45-1.27c-.03-.18-.05-.36-.05-.55 0-.19.02-.37.05-.55L10.3 8.78l.72-1.24 1.74.76c.27-.22.58-.39.91-.5L14 6.2h1.5l.33 1.6c.33.11.64.28.91.5l1.74-.76.72 1.24-1.45 1.27c.03.18.05.36.05.55 0 .19-.02.37-.05.55zM15.25 11c0-.69-.56-1.25-1.25-1.25s-1.25.56-1.25 1.25.56 1.25 1.25 1.25 1.25-.56 1.25-1.25z"/>
    </svg>
  ),
  emergency: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L1 21h22L12 2zm0 3.5l7.5 13.5h-15L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
    </svg>
  ),
  spinner: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="animate-spin">
      <path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/>
    </svg>
  ),
  checkCircle: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
    </svg>
  ),
  login: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11 7L9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z"/>
    </svg>
  ),
  token: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
    </svg>
  ),
};

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState('doctor');
  const [selectedWard, setSelectedWard] = useState('ward_a');
  const [selectedShift, setSelectedShift] = useState('morning');
  const [isLoading, setIsLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState('success');
  const [currentTime, setCurrentTime] = useState('');
  const [formData, setFormData] = useState({
    staffId: '',
    password: '',
    rememberMe: false
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

  const roles = [
    { id: 'doctor', label: 'Doctor', icon: Icons.stethoscope, sub: 'Full clinical access' },
    { id: 'nurse', label: 'Nurse', icon: Icons.medicalServices, sub: 'Ward patient access' },
    { id: 'clerk', label: 'Records Clerk', icon: Icons.folderShared, sub: 'Assigned records only' },
    { id: 'admin', label: 'Admin', icon: Icons.manageAccounts, sub: 'System administration' }
  ];

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleLogin = (e) => {
    e.preventDefault();
    setIsLoading(true);
    setToastType('success');
    setToastMessage(`Synchronizing credentials for ${formData.staffId} with Lagos Vault Node...`);
    setTimeout(() => {
      setIsLoading(false);
      setToastMessage('Success. Routing to Ward Patient Telemetry Board...');
    }, 1200);
  };

  const handleEmergencyOverride = () => {
    setToastType('danger');
    setToastMessage('TRAUMA OVERRIDE: CMO alert dispatched. Enter biometric key or emergency badge scan.');
  };

  return (
    <div className="min-h-screen bg-[#faf8ff] font-sans text-[#131b2e] antialiased flex flex-col justify-between">

      <main className="w-full flex-1 flex flex-col items-center justify-center p-4 md:p-6">
        <div className="w-full max-w-7xl mx-auto py-4 md:py-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 rounded-xl shadow-xl overflow-hidden bg-white">

            {/* LEFT COLUMN */}
            <div className="lg:col-span-5 relative flex flex-col justify-between p-6 md:p-10 bg-[#f2f3ff] overflow-hidden order-2 lg:order-1">
              <div
                className="absolute inset-0 opacity-40 mix-blend-multiply pointer-events-none"
                style={{ backgroundImage: 'radial-gradient(circle at 10% 20%, rgba(0, 94, 164, 0.08) 0%, transparent 60%), radial-gradient(circle at 90% 80%, rgba(0, 106, 98, 0.06) 0%, transparent 50%)' }}
              ></div>

              {/* Brand */}
              <div className="relative z-10 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-[#005ea4] rounded-lg flex items-center justify-center flex-shrink-0">
                      <span className="text-white font-bold text-base">G</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-semibold text-[18px] text-[#005ea4] tracking-tight leading-none">GridVault</span>
                      <span className="text-[11px] font-bold tracking-[0.05em] text-[#404752] uppercase">Clinical EMR</span>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#81f3e5] text-[#006f66] text-[11px] font-bold tracking-[0.05em] uppercase">
                    <span className="w-2 h-2 rounded-full bg-[#006a62] animate-pulse"></span>
                    Live Vault
                  </span>
                </div>

                <div className="mt-1">
                  <p className="text-[18px] font-semibold text-[#005ea4] tracking-tight">GridVault EHR v4.8</p>
                  <p className="text-[14px] text-[#404752] mt-1">Clinical Integrity & Instant Patient Telemetry</p>
                </div>

                {/* Compliance Badges */}
                <div className="flex flex-wrap gap-2 mt-1">
                  <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#eaedff] text-[#131b2e] text-[11px] font-bold tracking-[0.05em]">
                    <span className="text-[#005ea4]">{Icons.verifiedUser}</span>
                    NDPR Compliant
                  </div>
                  <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#eaedff] text-[#131b2e] text-[11px] font-bold tracking-[0.05em]">
                    <span className="text-[#006a62]">{Icons.lockClock}</span>
                    ISO 27001 Vault
                  </div>
                  <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#81f3e5]/60 text-[#006f66] text-[11px] font-bold tracking-[0.05em]">
                    <span className="text-[#006a62]">{Icons.dns}</span>
                    Nodes: Lagos & Abuja
                  </div>
                </div>
              </div>

              {/* Clinical Image */}
              <div className="relative z-10 my-6 rounded-xl overflow-hidden shadow-sm bg-[#dae2fd]">
                <div className="relative h-56 md:h-64 w-full">
                  <img
                    className="w-full h-full object-cover object-center"
                    src="/images/login-clinical.png"
                    alt="Two Nigerian healthcare professionals reviewing patient records"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#283044] via-[#283044]/30 to-transparent"></div>
                  <div className="absolute bottom-0 inset-x-0 p-4 text-[#eef0ff]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[#66d9cc]">{Icons.hospital}</span>
                      <p className="text-[12px] font-bold tracking-[0.02em] text-[#66d9cc] uppercase">St. Nicholas & Teaching Centers</p>
                    </div>
                    <p className="text-[20px] font-semibold text-[#eef0ff] leading-tight">Ward-Synchronized Electronic Charts</p>
                    <p className="text-[12px] text-[#d2d9f4] mt-1 line-clamp-2">Real-time vital diagnostics, medication administration records, and role-enforced telemetry.</p>
                  </div>
                </div>
              </div>

              {/* Role Security Callout */}
              <div className="relative z-10 p-4 rounded-lg bg-white shadow-sm flex items-start gap-3">
                <div className="p-2 rounded-md bg-[#d3e4ff] text-[#001c38] flex-shrink-0">
                  {Icons.policy}
                </div>
                <div>
                  <h4 className="text-[14px] font-semibold text-[#131b2e]">Role-Based Record Isolation</h4>
                  <p className="text-[12px] text-[#404752] mt-0.5 leading-relaxed">
                    Your verified credential bundle deterministically provisions decryption keys for assigned ward beds. Unassigned patient dossiers remain cryptographically inaccessible.
                  </p>
                </div>
              </div>

              {/* Audit Stamp */}
              <div className="relative z-10 mt-4 pt-3 border-t border-[#c0c7d4]/40 flex items-center justify-between text-[11px] font-bold text-[#707783]">
                <span className="flex items-center gap-1">
                  <span className="text-[#707783]">{Icons.terminal}</span>
                  Terminal Session: <span className="font-mono text-[#131b2e] ml-1">NG-LOS-0498</span>
                </span>
                <span className="font-mono text-[#131b2e]">{currentTime}</span>
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div className="lg:col-span-7 p-6 md:p-10 flex flex-col justify-center bg-white order-1 lg:order-2">

              {/* Toast */}
              {toastMessage && (
                <div className={`mb-6 px-4 py-3 rounded-lg text-[14px] font-semibold flex items-center gap-2 ${
                  toastType === 'danger' ? 'bg-[#ffdad6] text-[#93000a]' : 'bg-[#81f3e5] text-[#006f66]'
                }`}>
                  <span>{toastType === 'danger' ? Icons.emergency : Icons.checkCircle}</span>
                  {toastMessage}
                </div>
              )}

              {/* Header */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-1">
                  <h1 className="text-[24px] font-semibold tracking-tight text-[#131b2e]">Hospital Portal Login</h1>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#eaedff] text-[#005ea4] text-[11px] font-bold">
                    {Icons.key}
                    TLS 1.3
                  </span>
                </div>
                <p className="text-[14px] text-[#404752]">Sign in to access assigned ward charts and patient telemetry.</p>
              </div>

              {/* FORM */}
              <form onSubmit={handleLogin} className="space-y-5">

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Staff ID */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] font-bold tracking-[0.02em] text-[#131b2e] flex items-center gap-1">
                      Hospital Email or Staff ID
                      <span className="text-[#b6171e]">*</span>
                    </label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-[#707783] pointer-events-none">{Icons.badge}</span>
                      <input
                        type="text"
                        name="staffId"
                        value={formData.staffId}
                        onChange={handleInputChange}
                        placeholder="staff@hospital.ng"
                        required
                        className="w-full h-10 pl-9 pr-3 rounded-lg bg-[#f2f3ff] text-[#131b2e] text-[14px] placeholder:text-[#707783] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#005ea4] shadow-sm transition-all"
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[12px] font-bold tracking-[0.02em] text-[#131b2e] flex items-center gap-1">
                        Password <span className="text-[#b6171e]">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="text-[#005ea4] text-[11px] font-bold flex items-center gap-0.5 focus:outline-none"
                      >
                        {showPassword ? Icons.visibilityOff : Icons.visibilityOn}
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-[#707783] pointer-events-none">{Icons.lock}</span>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        name="password"
                        value={formData.password}
                        onChange={handleInputChange}
                        placeholder="Enter your password"
                        required
                        className="w-full h-10 pl-9 pr-10 rounded-lg bg-[#f2f3ff] text-[#131b2e] text-[14px] placeholder:text-[#707783] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#005ea4] shadow-sm transition-all"
                      />
                      <span className="absolute right-3 text-[#006a62]">{Icons.token}</span>
                    </div>
                  </div>
                </div>

                {/* Remember & Forgot */}
                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      name="rememberMe"
                      checked={formData.rememberMe}
                      onChange={handleInputChange}
                      className="w-4 h-4 rounded text-[#005ea4] focus:ring-[#005ea4] border-[#c0c7d4] cursor-pointer"
                    />
                    <span className="text-[12px] text-[#404752]">Remember credentials on this clinical terminal</span>
                  </label>
                  <button type="button" className="text-[#005ea4] text-[11px] font-bold focus:outline-none">
                    Forgot password?
                  </button>
                </div>

                {/* Role Selection */}
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-[14px] font-semibold text-[#131b2e]">
                      Select Clinical Role <span className="text-[#b6171e] text-sm">*</span>
                    </label>
                    <span className="text-[12px] text-[#404752]">Ensures privilege principle compliance</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    {roles.map(role => (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => setSelectedRole(role.id)}
                        className={`p-2.5 rounded-lg transition-all flex flex-col justify-between cursor-pointer ${
                          selectedRole === role.id
                            ? 'ring-2 ring-[#005ea4] bg-[#eaedff]'
                            : 'bg-[#f2f3ff] hover:bg-[#eaedff] ring-1 ring-[#c0c7d4]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="p-1.5 rounded-md bg-[#d3e4ff] text-[#001c38]">
                            {role.icon}
                          </div>
                          <input
                            type="radio"
                            name="clinical_role"
                            value={role.id}
                            checked={selectedRole === role.id}
                            readOnly
                            className="accent-[#005ea4] pointer-events-none"
                          />
                        </div>
                        <p className="text-[12px] font-bold text-[#131b2e] text-left">{role.label}</p>
                        <p className="text-[11px] text-[#404752] text-left mt-0.5">{role.sub}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ward & Shift */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] font-bold tracking-[0.02em] text-[#131b2e]">
                      Ward Assignment <span className="text-[#b6171e]">*</span>
                    </label>
                    <select
                      value={selectedWard}
                      onChange={(e) => setSelectedWard(e.target.value)}
                      className="h-10 px-3 rounded-lg bg-[#f2f3ff] text-[#131b2e] text-[14px] border border-[#c0c7d4] focus:outline-none focus:ring-2 focus:ring-[#005ea4] transition-all"
                    >
                      <option value="ward_a">Ward A (East Wing)</option>
                      <option value="ward_b">Ward B (West Wing)</option>
                      <option value="ward_c">Ward C (South Wing)</option>
                      <option value="icu">ICU</option>
                      <option value="maternity">Maternity</option>
                      <option value="emergency">Emergency</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] font-bold tracking-[0.02em] text-[#131b2e]">
                      Shift Assignment <span className="text-[#b6171e]">*</span>
                    </label>
                    <select
                      value={selectedShift}
                      onChange={(e) => setSelectedShift(e.target.value)}
                      className="h-10 px-3 rounded-lg bg-[#f2f3ff] text-[#131b2e] text-[14px] border border-[#c0c7d4] focus:outline-none focus:ring-2 focus:ring-[#005ea4] transition-all"
                    >
                      <option value="morning">Morning (6:00 AM - 2:00 PM)</option>
                      <option value="afternoon">Afternoon (2:00 PM - 10:00 PM)</option>
                      <option value="night">Night (10:00 PM - 6:00 AM)</option>
                    </select>
                  </div>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-[#005ea4] hover:bg-[#0077ce] disabled:opacity-70 text-white text-[14px] font-semibold py-3 rounded-lg shadow-md transition-all flex items-center justify-center gap-2 mt-2"
                >
                  {isLoading ? (
                    <>{Icons.spinner} Authenticating Terminal...</>
                  ) : (
                    <>Secure Login to GridVault {Icons.login}</>
                  )}
                </button>

                <p className="text-[11px] font-bold text-[#707783] text-center pt-2">
                  This access is logged and cryptographically signed. Unauthorized access attempts are automatically flagged.
                </p>

                {/* Emergency Override */}
                <div className="pt-3 border-t border-[#c0c7d4]/40">
                  <button
                    type="button"
                    onClick={handleEmergencyOverride}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 border-[#b6171e]/40 bg-[#ffdad6]/30 hover:bg-[#ffdad6]/60 text-[#b6171e] text-[12px] font-bold transition-all"
                  >
                    {Icons.emergency}
                    Emergency Clinical Override - Ward Crisis Access
                  </button>
                  <p className="text-[11px] text-[#707783] text-center mt-2">
                    Trauma override generates a mandatory CMO alert and creates an immutable audit record.
                  </p>
                </div>
              </form>
            </div>
          </div>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="w-full bg-[#eaedff] border-t border-[#c0c7d4]/40 py-4">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] font-bold text-[#707783]">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#006a62]"></span>
              Federal Ministry of Health Certified
            </span>
            <span className="text-[#c0c7d4]">•</span>
            <span>NDPR Registered Data Controller: GridVault NG Ltd</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#" className="hover:text-[#005ea4] transition-colors">Clinical Service Desk: +234 1 800 7233</a>
            <span className="text-[#c0c7d4]">•</span>
            <a href="#" className="hover:text-[#005ea4] transition-colors">Disaster Recovery Protocol</a>
          </div>
        </div>
      </footer>

    </div>
  );
}