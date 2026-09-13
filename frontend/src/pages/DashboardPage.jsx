import React, { useState } from 'react';

const Icons = {
  menu: (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
    </svg>
  ),
  meetingRoom: (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M14 6v15H3v-2h2V3h9l5 5v2h-5V6h-4zm6 8v-2h2v2h-2zm0 4v-2h2v2h-2zm0-8V8h2v2h-2zm-4 8v-2h2v2h-2zm0-4v-2h2v2h-2zm0-4V8h2v2h-2z"/>
    </svg>
  ),
  person: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
    </svg>
  ),
  settings: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
    </svg>
  ),
  logout: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
    </svg>
  ),
  schedule: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>
    </svg>
  ),
  gridView: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z"/>
    </svg>
  ),
  patientList: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/>
    </svg>
  ),
  monitorHeart: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.5 12.5H14l-2 5-4-10-2 5H4v2h3.5l1-2.5 4 10 3-7.5H18v-2h-2.5z M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.06L12 22l8.62-4.94C21.5 15.58 22 13.85 22 12c0-5.52-4.48-10-10-10zm0 18l-6.5-3.72C4.55 14.93 4 13.51 4 12c0-4.41 3.59-8 8-8s8 3.59 8 8c0 1.51-.55 2.93-1.5 4.28L12 20z"/>
    </svg>
  ),
  medication: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6.5 10h-2v2h2v2h2v-2h2v-2h-2V8h-2v2zm10 1c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-5 1c0-2.76-2.24-5-5-5S1.5 9.24 1.5 12s2.24 5 5 5 5-2.24 5-5zm7.5 5c-2.76 0-5 2.24-5 5h10c0-2.76-2.24-5-5-5z"/>
    </svg>
  ),
  clinicalNotes: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
    </svg>
  ),
  emergency: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L1 21h22L12 2zm0 3.5l7.5 13.5h-15L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
    </svg>
  ),
  lock: (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
    </svg>
  ),
  hospital: (
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H8v-4H6v-2h2V9h4v2h2v2h-2v4zm5-8h-2V7h-2V5h2V3h2v2h2v2h-2v2z"/>
    </svg>
  ),
  ward: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
    </svg>
  ),
  acute: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>
    </svg>
  ),
  tune: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/>
    </svg>
  ),
  checkCircle: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
    </svg>
  ),
  sync: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
    </svg>
  ),
  factCheck: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z"/>
    </svg>
  ),
  print: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/>
    </svg>
  ),
  search: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
    </svg>
  ),
  assignmentInd: (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm0 4c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm6 12H6v-1.4c0-2 4-3.1 6-3.1s6 1.1 6 3.1V19z"/>
    </svg>
  ),
  verifiedUser: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
    </svg>
  ),
  bed: (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 10V7c0-1.1-.9-2-2-2H4v5c-1.1 0-2 .9-2 2v5h1.33L4 19h1l.67-2h12.67l.66 2h1l.67-2H22v-5c0-1.1-.9-2-2-2zm-9 0H6V7h5v3zm7 0h-5V7h4a1 1 0 0 1 1 1v2z"/>
    </svg>
  ),
  history: (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>
    </svg>
  ),
  folderOpen: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/>
    </svg>
  ),
  editNote: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 10h11v2H3v-2zm0-4h11v2H3V6zm0 8h7v2H3v-2zm15.01-2.13l1.41-1.41 2.12 2.12-1.41 1.41-2.12-2.12zm-.71.71l-5.3 5.3V20h2.12l5.3-5.3-2.12-2.12z"/>
    </svg>
  ),
  notesMedical: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm1 14h-2v-2h2v2zm0-4h-2v-2h-2v2H9v-2H7v-2h2V9h2V7h2v2h2v2h-2v2z"/>
    </svg>
  ),
  monitorHeartSmall: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.5 12.5H14l-2 5-4-10-2 5H4v2h3.5l1-2.5 4 10 3-7.5H18v-2h-2.5z"/>
    </svg>
  ),
  medicationSmall: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6.5 10h-2v2h2v2h2v-2h2v-2h-2V8h-2v2zm10 1c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-5 1c0-2.76-2.24-5-5-5S1.5 9.24 1.5 12s2.24 5 5 5 5-2.24 5-5zm7.5 5c-2.76 0-5 2.24-5 5h10c0-2.76-2.24-5-5-5z"/>
    </svg>
  ),
  searchOff: (
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zm-2-4h2v2H7.5v-2zm0-2h2v-2H7.5v2z"/>
    </svg>
  ),
  warning: (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
    </svg>
  ),
  crisisAlert: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L1 21h22L12 2zm0 3.5l7.5 13.5h-15L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
    </svg>
  ),
};

export default function DashboardPage() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const patients = [
    {
      id: 'HOSP-LOS-2025-081',
      name: 'Chinedu Nnamdi',
      bed: 'A-04',
      status: 'stable',
      age: 42,
      diagnosis: 'Post-operative recovery, Appendectomy',
      vitals: { heartRate: 78, bp: '120/80', spo2: 98, temp: '36.8' },
      lastAccessed: '2 mins ago',
      notes: 3
    },
    {
      id: 'HOSP-LOS-2025-082',
      name: 'Amara Okafor',
      bed: 'A-05',
      status: 'observation',
      age: 31,
      diagnosis: 'Hypertensive crisis, under monitoring',
      vitals: { heartRate: 92, bp: '158/95', spo2: 96, temp: '37.2' },
      lastAccessed: '15 mins ago',
      notes: 5
    },
    {
      id: 'HOSP-LOS-2025-083',
      name: 'Funke Adeyemi',
      bed: 'A-06',
      status: 'stable',
      age: 55,
      diagnosis: 'Type 2 Diabetes, medication adjustment',
      vitals: { heartRate: 72, bp: '118/78', spo2: 99, temp: '36.5' },
      lastAccessed: '8 mins ago',
      notes: 2
    }
  ];

  const filteredPatients = patients.filter(p => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || p.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const stableCount = patients.filter(p => p.status === 'stable').length;
  const observationCount = patients.filter(p => p.status === 'observation').length;

  const navItems = [
    { icon: Icons.gridView, label: 'Ward Overview', active: true },
    { icon: Icons.patientList, label: 'Patient Roster', active: false },
    { icon: Icons.monitorHeart, label: 'Vitals & Triage', active: false },
    { icon: Icons.medication, label: 'MAR (Medications)', active: false },
    { icon: Icons.clinicalNotes, label: 'Nurse Notes & Handover', active: false },
    { icon: Icons.emergency, label: 'Code Blue & Rapid Call', active: false }
  ];

  return (
    <div className="min-h-screen bg-[#faf8ff] font-sans text-[#131b2e] antialiased">

      {/* FIXED HEADER */}
      <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-white border-b border-[#c0c7d4]">
        <div className="h-16 w-full px-6 flex items-center justify-between gap-4">

          <div className="flex items-center gap-4 flex-shrink-0">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden w-9 h-9 flex items-center justify-center text-[#404752] hover:bg-[#eaedff] rounded transition-colors"
            >
              {Icons.menu}
            </button>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-[#005ea4] rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-sm">G</span>
              </div>
              <span className="text-[18px] font-semibold text-[#005ea4] tracking-tight hidden sm:inline">GridVault</span>
            </div>
            <div className="h-6 w-px bg-[#c0c7d4]"></div>
            <div className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#eaedff] text-[#131b2e] border border-[#c0c7d4] text-[11px] font-bold tracking-[0.05em]">
              <span className="text-[#005ea4]">{Icons.meetingRoom}</span>
              Ward A • Inpatient Wing
            </div>
          </div>

          <div className="hidden md:flex flex-col items-center justify-center text-center">
            <div className="text-[14px] font-semibold text-[#005ea4]">Good Morning, Chioma</div>
            <div className="text-[12px] text-[#404752]">Staff Nurse • St. Nicholas Hospital Lagos</div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <div className="hidden lg:inline-flex items-center gap-1 px-3 py-1 rounded bg-[#81f3e5]/30 border border-[#006a62]/20 text-[#006f66] text-[11px] font-bold">
              <span className="text-[#006a62]">{Icons.schedule}</span>
              Morning (6:00 AM - 2:00 PM)
            </div>
            <button className="w-9 h-9 rounded flex items-center justify-center text-[#404752] hover:bg-[#e2e7ff] border border-[#c0c7d4] transition-colors">
              {Icons.settings}
            </button>
            <div className="w-8 h-8 rounded-full bg-[#005ea4] flex items-center justify-center flex-shrink-0 text-white">
              {Icons.person}
            </div>
            <a
              href="/login"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-[#c0c7d4] text-[#ba1a1a] hover:bg-[#ffdad6] hover:text-[#93000a] text-[12px] font-bold transition-colors"
            >
              {Icons.logout}
              <span className="hidden sm:inline">Logout</span>
            </a>
          </div>
        </div>
      </header>

      {/* SIDEBAR */}
      {sidebarOpen && (
        <aside className="fixed left-0 top-16 bottom-0 w-64 bg-white border-r border-[#c0c7d4] z-40 flex flex-col justify-between overflow-y-auto">
          <div className="p-4">
            <div className="text-[11px] font-bold tracking-[0.05em] text-[#404752] uppercase mb-3 px-2">
              Ward Navigation
            </div>
            <nav className="flex flex-col gap-1">
              {navItems.map((item, idx) => (
                <a
                  key={idx}
                  href="#"
                  className={`flex items-center gap-3 px-2 py-2 rounded transition-colors text-[14px] font-semibold ${
                    item.active
                      ? 'bg-[#d3e4ff] text-[#005ea4] font-bold shadow-sm'
                      : 'text-[#404752] hover:bg-[#eaedff] hover:text-[#131b2e]'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </a>
              ))}
            </nav>
          </div>

          <div className="p-4 border-t border-[#c0c7d4] bg-[#f2f3ff]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-[#404752] flex items-center gap-1">
                <span className="text-[#006a62]">{Icons.lock}</span>
                NDPR Compliant
              </span>
              <span className="text-[11px] font-bold text-[#006a62]">Audit: Active</span>
            </div>
            <p className="text-[10px] text-[#404752] leading-tight">
              Session cryptographically signed. St. Nicholas Medical System node NG-LOS-01.
            </p>
          </div>
        </aside>
      )}

      {/* MAIN CONTENT */}
      <div className={`${sidebarOpen ? 'lg:pl-64' : ''} pt-16`}>
        <main className="min-h-screen bg-[#faf8ff] w-full">
          <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col gap-6">

            {/* GREETING CARD */}
            <div className="bg-white rounded-xl p-6 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-start sm:items-center gap-4">
                <div className="relative w-14 h-14 rounded-xl bg-[#eaedff] flex items-center justify-center flex-shrink-0 text-[#005ea4]">
                  {Icons.hospital}
                  <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[#006a62] ring-2 ring-white flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
                  </span>
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[20px] font-semibold text-[#131b2e]">Good Morning, Chioma</span>
                    <span className="px-1 py-0.5 rounded bg-[#eaedff] text-[11px] font-bold text-[#404752]">RN-STN-2025</span>
                  </div>
                  <div className="text-[14px] text-[#404752] flex items-center gap-2 flex-wrap mt-0.5">
                    <span className="text-[12px] font-bold text-[#005ea4]">RN Chioma Okonkwo</span>
                    <span className="text-[#c0c7d4]">•</span>
                    <span className="text-[12px]">ID: SN-7742</span>
                    <span className="text-[#c0c7d4]">•</span>
                    <span className="text-[12px]">Ward A Inpatient Nursing Station</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 bg-[#eaedff] px-4 py-2 rounded-lg">
                  <span className="text-[#005ea4]">{Icons.ward}</span>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold tracking-[0.05em] text-[#404752] uppercase leading-none">Ward Allocation</span>
                    <span className="text-[12px] font-bold text-[#131b2e]">Ward A (East Wing)</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-[#eaedff] px-4 py-2 rounded-lg">
                  <span className="text-[#006a62]">{Icons.acute}</span>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold tracking-[0.05em] text-[#404752] uppercase leading-none">Shift Assignment</span>
                    <span className="text-[12px] font-bold text-[#131b2e]">Morning (6:00 AM - 2:00 PM)</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="w-10 h-10 rounded-lg bg-[#eaedff] text-[#404752] hover:bg-[#e2e7ff] flex items-center justify-center transition-colors">
                    {Icons.tune}
                  </button>
                  <a
                    href="/login"
                    className="px-4 h-10 rounded-lg bg-[#ffdad6] text-[#93000a] hover:bg-[#ba1a1a] hover:text-white text-[12px] font-bold flex items-center gap-1 transition-colors"
                  >
                    {Icons.logout}
                    <span>Logout</span>
                  </a>
                </div>
              </div>
            </div>

            {/* TELEMETRY STRIP */}
            <div className="bg-white rounded-xl p-4 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center flex-wrap gap-4">
                <div className="inline-flex items-center gap-1.5 bg-[#81f3e5]/25 text-[#006a62] px-3 py-1 rounded-full text-[12px] font-bold">
                  <span className="text-[#006a62]">{Icons.checkCircle}</span>
                  3 Patients Assigned
                </div>
                <div className="inline-flex items-center gap-1.5 text-[#404752] px-3 py-1 rounded-full bg-[#eaedff] text-[12px] font-bold">
                  <span className="text-[#006a62]">{Icons.sync}</span>
                  Last sync: 2 mins ago
                </div>
                <div className="inline-flex items-center gap-1.5 text-[#006a62] px-3 py-1 rounded-full bg-[#81f3e5]/25 text-[12px] font-bold">
                  <span className="w-2 h-2 rounded-full bg-[#006a62] animate-pulse"></span>
                  Online • Lagos Vault Node
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-[#eaedff] text-[#131b2e] text-[12px] font-bold rounded-xl shadow-sm border border-[#c0c7d4] transition-colors">
                  <span className="text-[#005ea4]">{Icons.factCheck}</span>
                  Batch Vitals Sign-off
                </button>
                <button className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-[#eaedff] text-[#131b2e] text-[12px] font-bold rounded-xl shadow-sm border border-[#c0c7d4] transition-colors">
                  <span className="text-[#006a62]">{Icons.print}</span>
                  Handover Sheet
                </button>
              </div>
            </div>

            {/* SEARCH & FILTERS */}
            <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm">
              <div className="mb-4">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#707783] pointer-events-none">{Icons.search}</span>
                  <input
                    type="text"
                    placeholder="Search patient name or ID..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setSearchQuery('')}
                    className="w-full h-10 pl-10 pr-20 rounded-lg bg-[#eaedff] text-[#131b2e] text-[14px] placeholder:text-[#707783] focus:outline-none focus:ring-2 focus:ring-[#005ea4] transition-all"
                  />
                  <div className="absolute inset-y-0 right-3 flex items-center">
                    <span className="text-[11px] font-bold text-[#404752] bg-[#dae2fd] px-1.5 py-0.5 rounded uppercase">ESC to clear</span>
                  </div>
                </div>
              </div>

              <div className="bg-[#e2e7ff] p-1 rounded-xl flex items-center gap-1 w-fit">
                {[
                  { label: 'All', value: 'all', count: patients.length },
                  { label: 'Stable', value: 'stable', count: stableCount },
                  { label: 'Observation', value: 'observation', count: observationCount }
                ].map(f => (
                  <button
                    key={f.value}
                    onClick={() => setFilterStatus(f.value)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-bold whitespace-nowrap transition-all ${
                      filterStatus === f.value
                        ? 'bg-[#005ea4] text-white shadow-sm'
                        : 'text-[#404752] hover:text-[#131b2e]'
                    }`}
                  >
                    {f.label} ({f.count})
                  </button>
                ))}
              </div>
            </div>

            {/* PATIENT CARDS */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-[#005ea4]">{Icons.assignmentInd}</span>
                  <h2 className="text-[20px] font-semibold text-[#131b2e]">Assigned Inpatients Under Your Direct Care</h2>
                </div>
                <div className="hidden md:flex items-center gap-1.5 text-[12px] text-[#404752]">
                  <span className="text-[#006a62]">{Icons.verifiedUser}</span>
                  Standard Ward A protocol enforced
                </div>
              </div>

              <div className="flex flex-col gap-4">
                {filteredPatients.length > 0 ? filteredPatients.map(patient => (
                  <article
                    key={patient.id}
                    className="bg-white rounded-xl shadow-sm hover:shadow-md transition-all overflow-hidden"
                    style={{ borderLeft: `4px solid ${patient.status === 'stable' ? '#006a62' : '#b6171e'}` }}
                  >
                    <div className={`h-1.5 w-full ${patient.status === 'stable' ? 'bg-[#006a62]' : 'bg-[#b6171e]'}`}></div>
                    <div className="p-4 sm:p-6">
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className="text-[18px] font-semibold text-[#131b2e]">{patient.name}</h3>
                            <span className="px-2 py-0.5 rounded bg-[#eaedff] text-[11px] font-bold text-[#404752]">{patient.id}</span>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                              patient.status === 'stable' ? 'bg-[#81f3e5]/30 text-[#006a62]' : 'bg-[#ffdad6] text-[#93000a]'
                            }`}>
                              {patient.status === 'stable' ? Icons.checkCircle : Icons.warning}
                              {patient.status === 'stable' ? 'Stable' : 'Observation'}
                            </span>
                          </div>
                          <div className="text-[12px] text-[#404752] flex items-center gap-2 flex-wrap">
                            <span className="flex items-center gap-1">{Icons.bed} Bed {patient.bed}</span>
                            <span className="text-[#c0c7d4]">•</span>
                            <span>Age {patient.age}</span>
                            <span className="text-[#c0c7d4]">•</span>
                            <span>{patient.diagnosis}</span>
                          </div>
                          <div className="text-[11px] text-[#707783] mt-1 flex items-center gap-1">
                            {Icons.history} Last accessed {patient.lastAccessed}
                          </div>
                        </div>
                        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 flex-shrink-0">
                          <button className="inline-flex items-center gap-1 px-4 py-2 bg-[#005ea4] hover:bg-[#0077ce] text-white text-[12px] font-bold rounded-lg transition-colors whitespace-nowrap">
                            {Icons.folderOpen} View Record
                          </button>
                          <button className="inline-flex items-center gap-1 px-4 py-2 bg-[#eaedff] hover:bg-[#e2e7ff] text-[#131b2e] text-[12px] font-bold rounded-lg transition-colors whitespace-nowrap">
                            {Icons.editNote} Add Note
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-[#e2e7ff]">
                        <div className="bg-[#eaedff] p-3 rounded-lg text-center">
                          <p className="text-[11px] font-bold tracking-[0.05em] text-[#404752] uppercase mb-1">Heart Rate</p>
                          <p className="text-[22px] font-bold text-[#005ea4]">{patient.vitals.heartRate}</p>
                          <p className="text-[11px] text-[#404752]">bpm</p>
                        </div>
                        <div className="bg-[#eaedff] p-3 rounded-lg text-center">
                          <p className="text-[11px] font-bold tracking-[0.05em] text-[#404752] uppercase mb-1">Blood Pressure</p>
                          <p className="text-[22px] font-bold text-[#005ea4]">{patient.vitals.bp}</p>
                          <p className="text-[11px] text-[#404752]">mmHg</p>
                        </div>
                        <div className="bg-[#eaedff] p-3 rounded-lg text-center">
                          <p className="text-[11px] font-bold tracking-[0.05em] text-[#404752] uppercase mb-1">SpO2</p>
                          <p className="text-[22px] font-bold text-[#006a62]">{patient.vitals.spo2}%</p>
                          <p className="text-[11px] text-[#404752]">oxygen</p>
                        </div>
                        <div className="bg-[#eaedff] p-3 rounded-lg text-center">
                          <p className="text-[11px] font-bold tracking-[0.05em] text-[#404752] uppercase mb-1">Temperature</p>
                          <p className="text-[22px] font-bold text-[#005ea4]">{patient.vitals.temp}</p>
                          <p className="text-[11px] text-[#404752]">°C</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-3 mt-3 border-t border-[#e2e7ff] flex-wrap gap-2">
                        <div className="flex items-center gap-1 text-[12px] text-[#404752]">
                          {Icons.notesMedical} {patient.notes} clinical notes on record
                        </div>
                        <div className="flex items-center gap-2">
                          <button className="inline-flex items-center gap-1 text-[12px] font-bold text-[#005ea4] hover:underline">
                            {Icons.monitorHeartSmall} View Vitals History
                          </button>
                          <span className="text-[#c0c7d4]">•</span>
                          <button className="inline-flex items-center gap-1 text-[12px] font-bold text-[#005ea4] hover:underline">
                            {Icons.medicationSmall} Medications
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                )) : (
                  <div className="bg-white rounded-xl p-12 text-center shadow-sm">
                    <span className="text-[#c0c7d4] block mb-3 flex justify-center">{Icons.searchOff}</span>
                    <p className="text-[16px] font-semibold text-[#404752]">No patients found matching your search.</p>
                    <button
                      onClick={() => { setSearchQuery(''); setFilterStatus('all'); }}
                      className="mt-4 text-[12px] font-bold text-[#005ea4] hover:underline"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* EMERGENCY OVERRIDE */}
            <div className="bg-[#ffdad6] rounded-xl p-6 border border-[#b6171e]/30">
              <div className="flex items-center justify-between gap-4 flex-col sm:flex-row">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-12 h-12 bg-[#b6171e] rounded-xl flex items-center justify-center flex-shrink-0 text-white">
                    {Icons.emergency}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[16px] font-bold text-[#131b2e]">Emergency Override Access</p>
                    <p className="text-[12px] text-[#404752] mt-1 leading-relaxed">
                      Need immediate access to an unassigned patient? Override grants instant access and generates a mandatory CMO alert with immutable audit record.
                    </p>
                  </div>
                </div>
                <button className="bg-[#b6171e] hover:bg-[#93000a] text-white text-[14px] font-bold px-6 py-3 rounded-lg transition-all whitespace-nowrap shadow-md flex items-center gap-2 flex-shrink-0">
                  {Icons.crisisAlert}
                  Emergency Access
                </button>
              </div>
            </div>

          </div>
        </main>
      </div>
    </div>
  );
}