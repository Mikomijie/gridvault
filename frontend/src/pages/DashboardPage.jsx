import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { cacheRoster, getCachedRoster } from '../lib/cache.js';
import OfflineBar from '../components/OfflineBar.jsx';
import en from '../i18n/en.json';

const Icons = {
  menu: (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
    </svg>
  ),
  meetingRoom: (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M14 6v15H3v-2h2V3h9l5 5v2h-5V6h-4zm6 8v-2h2v2h-2zm0 4v-2h2v2h-2zm0-8V8h2v2h-2zm-4 8v-2h2v2h-2zm0-4v-2h2v2h-2zm0-4V8h2v2h-2z" />
    </svg>
  ),
  person: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  ),
  logout: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
    </svg>
  ),
  schedule: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" />
    </svg>
  ),
  hospital: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H8v-4H6v-2h2V9h4v2h2v2h-2v4zm5-8h-2V7h-2V5h2V3h2v2h2v2h-2v2z" />
    </svg>
  ),
  lock: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
    </svg>
  ),
  search: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
    </svg>
  ),
  clear: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.47 2 2 6.48 2 12s4.47 10 10 10 10-4.48 10-10S17.53 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
    </svg>
  ),
  ward: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" />
    </svg>
  ),
  acute: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
    </svg>
  ),
  vitalsIcon: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 9.5c1.93 0 3.5-1.57 3.5-3.5S15.93 5 14 5s-3.5 1.57-3.5 3.5 1.57 3.5 3.5 3.5z" />
    </svg>
  ),
  checkCircle: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  ),
  warningIcon: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
    </svg>
  ),
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, dutyState, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [fromCache, setFromCache] = useState(false);

  const navItems = [
    { to: '/dashboard', label: 'Ward Dashboard', icon: Icons.meetingRoom },
    { to: '/dashboard/handover', label: 'Shift Handover', icon: Icons.schedule },
    { to: '/dashboard/security', label: 'Audit & Security', icon: Icons.lock },
  ];

  useEffect(() => {
    const fetchPatients = async () => {
      try {
        const res = await api.roster();
setPatients(res.data || []);
        cacheRoster(res.data.patients || []);
        setFromCache(false);
      } catch (error) {
        const cached = getCachedRoster();
        if (cached && cached.length > 0) {
          setPatients(cached);
          setFromCache(true);
        } else {
          setLoadError('Unable to load patients');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchPatients();
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const filtered = patients.filter((p) => {
    const matchesSearch = !searchQuery || p.full_name.toLowerCase().includes(searchQuery.toLowerCase()) || p.hospital_number.includes(searchQuery) || p.bed_number.includes(searchQuery);
    const matchesStatus = filterStatus === 'all' || p.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status) => {
    switch (status) {
      case 'stable':
        return 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
      case 'observation':
        return 'bg-amber-500/20 border-amber-500/40 text-amber-300';
      case 'critical':
        return 'bg-red-500/20 border-red-500/40 text-red-300';
      default:
        return 'bg-slate-600/20 border-slate-500/40 text-slate-300';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white">
      {/* HEADER */}
      <header className="fixed top-0 left-0 right-0 h-16 bg-slate-800 border-b border-slate-700 z-50 flex items-center px-4 sm:px-6">
        <button
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="lg:hidden p-2 hover:bg-slate-700 rounded text-slate-400 hover:text-emerald-400 transition-colors"
        >
          {Icons.menu}
        </button>

        <div className="flex-1 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm">G</span>
            </div>
            <span className="font-semibold text-lg text-emerald-400 hidden sm:inline">
              GridVault
            </span>
            <div className="h-6 w-px bg-slate-600"></div>
            <div className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold tracking-[0.05em]">
              <span className="text-emerald-400">{Icons.meetingRoom}</span>
              Ward A • Inpatient Wing
            </div>
          </div>

          <div className="hidden md:flex flex-col items-center justify-center text-center">
            <div className="text-[14px] font-semibold text-emerald-300">
              {user?.full_name ?? en.dashboard.title}
            </div>
            <div className="text-[12px] text-slate-400">
              {user ? `${user.role} • ${user.ward}` : ''}{dutyState ? ` • ${en.dashboard.dutyLabel}: ${dutyState}` : ''}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <div className="hidden lg:inline-flex items-center gap-1 px-3 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold">
              <span className="text-emerald-400">{Icons.schedule}</span>
              Morning (6:00 AM - 2:00 PM)
            </div>
            <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center flex-shrink-0 text-white">
              {Icons.person}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-slate-600 text-red-400 hover:bg-red-500/20 hover:border-red-500/40 text-[12px] font-bold transition-colors"
            >
              {Icons.logout}
              <span className="hidden sm:inline">{en.dashboard.logout}</span>
            </button>
          </div>
        </div>
      </header>

      {/* SIDEBAR */}
      {sidebarOpen && (
        <aside className="fixed left-0 top-16 bottom-0 w-64 bg-slate-800 border-r border-slate-700 z-40 flex flex-col justify-between overflow-y-auto">
          <div className="p-4">
            <div className="text-[11px] font-bold tracking-[0.05em] text-slate-400 uppercase mb-3 px-2">
              Ward Navigation
            </div>
            <nav className="flex flex-col gap-1">
              {navItems.map((item) => {
                const active =
                  item.to === '/dashboard'
                    ? window.location.pathname === '/dashboard'
                    : window.location.pathname.startsWith(item.to);
                return (
                  <button
                    key={item.to}
                    type="button"
                    onClick={() => navigate(item.to)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex w-full items-center gap-3 px-2 py-2 rounded transition-colors text-[14px] font-semibold ${
                      active
                        ? 'bg-emerald-600/30 text-emerald-300 font-bold shadow-sm border border-emerald-500/40'
                        : 'text-slate-400 hover:bg-slate-700/50 hover:text-emerald-300'
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="p-4 border-t border-slate-700 bg-slate-700/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                <span className="text-emerald-400">{Icons.lock}</span>
                Audit log active
              </span>
              <span className="text-[11px] font-bold text-emerald-400">Active</span>
            </div>
            <p className="text-[10px] text-slate-400 leading-tight">
              Session cryptographically signed. St. Nicholas Medical System node NG-LOS-01.
            </p>
          </div>
        </aside>
      )}

      {/* MAIN CONTENT */}
      <div className={`${sidebarOpen ? 'lg:pl-64' : ''} pt-16`}>
        <main className="min-h-screen w-full">
          <OfflineBar />
          <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col gap-6">
            {/* GREETING CARD */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-start sm:items-center gap-4">
                <div className="relative w-14 h-14 rounded-xl bg-emerald-600/30 border border-emerald-500/40 flex items-center justify-center flex-shrink-0 text-emerald-300">
                  {Icons.hospital}
                  <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 ring-2 ring-slate-800 flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-300"></span>
                  </span>
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[20px] font-semibold text-white">
                      {user?.full_name ?? ''}
                    </span>
                    <span className="px-1 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-bold text-emerald-300">
                      {user?.role ?? ''}
                    </span>
                  </div>
                  <div className="text-[14px] text-slate-400 flex items-center gap-2 flex-wrap mt-0.5">
                    <span className="text-[12px] font-bold text-emerald-400">{user?.staff_id ?? ''}</span>
                    <span className="text-slate-600">•</span>
                    <span className="text-[12px]">{user?.ward ?? ''}</span>
                    {dutyState && (
                      <>
                        <span className="text-slate-600">•</span>
                        <span className="text-[12px]">{en.dashboard.dutyLabel}: {dutyState}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 bg-emerald-600/20 border border-emerald-500/30 px-4 py-2 rounded-lg">
                  <span className="text-emerald-400">{Icons.ward}</span>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold tracking-[0.05em] text-slate-400 uppercase leading-none">
                      Ward Allocation
                    </span>
                    <span className="text-[12px] font-bold text-emerald-300">{user?.ward ?? ''}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-emerald-600/20 border border-emerald-500/30 px-4 py-2 rounded-lg">
                  <span className="text-emerald-400">{Icons.acute}</span>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold tracking-[0.05em] text-slate-400 uppercase leading-none">
                      Shift Assignment
                    </span>
                    <span className="text-[12px] font-bold text-emerald-300">
                      {user?.shift ?? ''}{dutyState ? ` (${dutyState})` : ''}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="px-4 h-10 rounded-lg bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 text-[12px] font-bold flex items-center gap-1 transition-colors"
                  >
                    {Icons.logout} Logout
                  </button>
                </div>
              </div>
            </div>

            {/* SEARCH & FILTER */}
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Search patients by name, bed, or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-4 py-2 pl-10 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                />
                <span className="absolute left-3 top-2.5 text-slate-500">{Icons.search}</span>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-2.5 text-slate-500 hover:text-emerald-400 transition-colors"
                  >
                    {Icons.clear}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                {['all', 'stable', 'observation', 'critical'].map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setFilterStatus(status)}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                      filterStatus === status
                        ? 'bg-emerald-600 text-white border border-emerald-500'
                        : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-emerald-300 hover:border-emerald-500/40'
                    }`}
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* ERROR STATE */}
            {loadError && (
              <div className="bg-red-500/20 border border-red-500/40 rounded-lg p-4 text-red-300">
                <p className="font-semibold">{loadError}</p>
              </div>
            )}

            {/* LOADING STATE */}
            {loading && (
              <div className="text-center py-12 text-slate-400">
                <p>Loading patients...</p>
              </div>
            )}

            {/* OFFLINE NOTICE */}
            {fromCache && (
              <div className="bg-amber-500/20 border border-amber-500/40 rounded-lg p-4 text-amber-300">
                <p className="text-sm">Displaying cached data. System is offline.</p>
              </div>
            )}

            {/* PATIENT GRID */}
            {!loading && filtered.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((patient) => (
                  <button
                    key={patient.id}
                    type="button"
                    onClick={() => navigate(`/dashboard/patient/${patient.id}`)}
                    className="bg-slate-800 border border-slate-700 hover:border-emerald-500/50 rounded-lg p-5 shadow-lg hover:shadow-emerald-500/20 transition-all text-left hover:scale-[1.02] transform duration-150"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-bold text-white text-lg">{patient.full_name}</h3>
                        <p className="text-sm text-slate-400">{patient.hospital_number}</p>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-bold border ${getStatusColor(patient.status)}`}>
                        {patient.status.charAt(0).toUpperCase() + patient.status.slice(1)}
                      </span>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Bed:</span>
                        <span className="font-semibold text-emerald-300">{patient.bed_number}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Age:</span>
                        <span className="font-semibold text-emerald-300">{patient.age} years</span>
                      </div>
                      {patient.vitals && (
                        <>
                          <div className="pt-2 mt-2 border-t border-slate-700 space-y-1">
                            <div className="flex justify-between text-xs">
                              <span className="text-slate-400">HR: {patient.vitals.heart_rate} bpm</span>
                              <span className="text-slate-400">BP: {patient.vitals.blood_pressure}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-slate-400">SpO2: {patient.vitals.oxygen_saturation}%</span>
                              <span className="text-slate-400">Temp: {patient.vitals.temperature}°C</span>
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-700 flex items-center gap-1 text-emerald-400 text-sm font-semibold hover:text-emerald-300">
                      View Details →
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* EMPTY STATE */}
            {!loading && filtered.length === 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-lg p-12 text-center">
                <div className="text-slate-400 text-5xl mb-4">{Icons.search}</div>
                <h3 className="text-white font-bold text-lg mb-1">No patients found</h3>
                <p className="text-slate-400">{searchQuery ? 'Try adjusting your search' : 'Loading your ward roster...'}</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}