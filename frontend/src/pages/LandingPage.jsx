import React, { useState } from 'react';

const Icons = {
  verifiedUser: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
    </svg>
  ),
  hospital: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H8v-4H6v-2h2V9h4v2h2v2h-2v4zm5-8h-2V7h-2V5h2V3h2v2h2v2h-2v2z"/>
    </svg>
  ),
  play: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
    </svg>
  ),
  verified: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M23 12l-2.44-2.79.34-3.69-3.61-.82-1.89-3.2L12 2.96 8.6 1.5 6.71 4.69 3.1 5.5l.34 3.7L1 12l2.44 2.79-.34 3.7 3.61.82 1.89 3.2L12 21.04l3.4 1.46 1.89-3.19 3.61-.82-.34-3.69L23 12zm-12.91 4.72l-3.8-3.81 1.48-1.48 2.32 2.33 5.85-5.87 1.48 1.48-7.33 7.35z"/>
    </svg>
  ),
  crisisAlert: (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L1 21h22L12 2zm0 3.5l7.5 13.5h-15L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
    </svg>
  ),
  cloudOff: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM3 5.27l2.28 2.28C4.48 8.7 4 9.82 4 11h2c0-.61.19-1.17.51-1.63L18.73 21 20 19.73 4.27 4 3 5.27zM19 18H7.27l9-9H19c1.65 0 3 1.35 3 3s-1.35 3-3 3z"/>
    </svg>
  ),
  adminPanel: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 4l5 2.18V11c0 3.5-2.33 6.79-5 7.93-2.67-1.14-5-4.43-5-7.93V7.18L12 5z"/>
    </svg>
  ),
  menu: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
    </svg>
  ),
  person: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
    </svg>
  ),
  lock: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
    </svg>
  ),
  hub: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
    </svg>
  ),
};

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#faf8ff] font-sans text-[#131b2e] antialiased flex flex-col">

      {/* FIXED TOP BAR + HEADER */}
      <div className="fixed top-0 left-0 right-0 z-50">

        {/* COMPLIANCE BAR */}
        <aside className="w-full bg-[#eaedff] text-[#404752] border-b border-[#c0c7d4]/40 py-2">
          <div className="max-w-[1280px] mx-auto px-6 flex items-center justify-between text-[11px] font-bold tracking-[0.05em]">
            <div className="flex items-center gap-2 text-[#006a62]">
              {Icons.verifiedUser}
              <span className="text-[#404752] tracking-wide">NDPR (Nigeria Data Protection Regulation) Compliant & ISO 27001 Certified Infrastructure for Healthcare Facilities</span>
            </div>
            <div className="hidden md:flex items-center gap-6 text-[#404752]">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-[#006a62]"></span>
                Lagos & Abuja Cluster Online
              </span>
              <span className="text-[#c0c7d4]">|</span>
              <span>FMOH Interoperability Standard v2.4</span>
            </div>
          </div>
        </aside>

        {/* MAIN HEADER */}
        <header className="w-full bg-white/95 backdrop-blur-md border-b border-[#c0c7d4]/40">
          <div className="h-20 max-w-[1280px] mx-auto px-6 flex items-center justify-between">

            {/* Logo */}
            <div className="flex items-center gap-4">
              <div className="w-9 h-9 bg-[#005ea4] rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-base">G</span>
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-[18px] text-[#005ea4] tracking-tight leading-none">GridVault</span>
                <span className="text-[11px] font-bold tracking-[0.05em] text-[#404752] uppercase">Clinical EMR</span>
              </div>
            </div>

            {/* Desktop Nav */}
            <nav className="hidden xl:flex items-center gap-5 text-[13px] font-semibold tracking-[0.01em]">
              <a href="#solutions" className="text-[#404752] hover:text-[#005ea4] transition-colors">Solutions</a>
              <a href="#features" className="text-[#404752] hover:text-[#005ea4] transition-colors">Features</a>
              <a href="#emergency" className="text-[#404752] hover:text-[#005ea4] transition-colors">Emergency Access</a>
              <a href="#offline" className="text-[#404752] hover:text-[#005ea4] transition-colors">Offline Architecture</a>
              <a href="#security" className="text-[#404752] hover:text-[#005ea4] transition-colors">Trust & Security</a>
              <a href="#pricing" className="text-[#404752] hover:text-[#005ea4] transition-colors">Pricing</a>
            </nav>

            {/* CTA Buttons */}
            <div className="flex items-center gap-3">
              <a href="/login" className="hidden xl:inline-flex items-center text-[13px] font-semibold text-[#404752] hover:text-[#005ea4] px-3 py-2 rounded transition-colors">
                Hospital Portal Login
              </a>
              <a href="/login" className="hidden xl:inline-flex items-center justify-center bg-[#005ea4] hover:bg-[#0077ce] text-white text-[13px] font-semibold px-5 py-2.5 rounded-lg shadow-sm transition-all">
                Request Demo
              </a>
              <div className="hidden sm:flex w-8 h-8 rounded-full bg-[#005ea4] items-center justify-center text-white">
                {Icons.person}
              </div>
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="xl:hidden w-9 h-9 flex items-center justify-center text-[#404752] hover:bg-[#eaedff] rounded-lg transition-colors"
              >
                {Icons.menu}
              </button>
            </div>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="xl:hidden bg-white border-t border-[#c0c7d4]/40 px-6 py-4 space-y-3">
              <a href="#solutions" className="block text-[14px] font-semibold text-[#404752] hover:text-[#005ea4]">Solutions</a>
              <a href="#features" className="block text-[14px] font-semibold text-[#404752] hover:text-[#005ea4]">Features</a>
              <a href="#emergency" className="block text-[14px] font-semibold text-[#404752] hover:text-[#005ea4]">Emergency Access</a>
              <a href="#offline" className="block text-[14px] font-semibold text-[#404752] hover:text-[#005ea4]">Offline Architecture</a>
              <a href="#security" className="block text-[14px] font-semibold text-[#404752] hover:text-[#005ea4]">Trust & Security</a>
              <a href="/login" className="block w-full text-center bg-[#005ea4] text-white text-[14px] font-semibold py-2.5 rounded-lg mt-4">
                Request Demo
              </a>
            </div>
          )}
        </header>
      </div>

      {/* MAIN CONTENT */}
      <main className="w-full pt-28 flex-1 bg-[#faf8ff]">

        {/* HERO SECTION */}
        <section className="w-full bg-white">
          <div className="max-w-[1280px] mx-auto px-6 py-10 lg:py-24">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">

              {/* Hero Left */}
              <div className="flex flex-col items-start">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#eaedff] text-[#005ea4] text-[11px] font-bold tracking-[0.05em] uppercase mb-6">
                  <span className="text-[#005ea4]">{Icons.hospital}</span>
                  Engineered for Nigerian Tertiary & Private Healthcare
                </div>

                <h1 className="text-[34px] sm:text-[48px] font-bold text-[#131b2e] tracking-tight leading-none mb-6">
                  Secure Patient Records.<br className="hidden sm:inline" />
                  <span className="text-[#005ea4]"> Faster Care.</span>
                </h1>

                <p className="text-[16px] text-[#404752] max-w-xl mb-8 leading-relaxed">
                  Hospital staff can access patient records by role and ward, with tamper-proof emergency access logs.
                </p>

                {/* CTA Buttons */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full sm:w-auto mb-10">
                  <a href="/login" className="inline-flex items-center justify-center bg-[#005ea4] hover:bg-[#0077ce] text-white text-[14px] font-semibold px-8 py-3.5 rounded-lg shadow-sm transition-all text-center">
                    Request Demo
                  </a>
                  <button className="inline-flex items-center justify-center gap-2 bg-[#f2f3ff] hover:bg-[#eaedff] text-[#131b2e] text-[14px] font-semibold px-6 py-3.5 rounded-lg transition-colors text-center">
                    <span className="text-[#005ea4]">{Icons.play}</span>
                    Watch 2-Min System Walkthrough
                  </button>
                </div>

                {/* Trust Metrics */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pt-6 border-t border-[#c0c7d4]/30 w-full">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#006a62] animate-pulse"></span>
                    <span className="text-[11px] font-bold tracking-[0.05em] text-[#131b2e]">99.98% Uptime Across State Grids</span>
                  </div>
                  <span className="hidden sm:block text-[#c0c7d4]">•</span>
                  <div className="flex items-center gap-1.5 text-[#404752] text-[11px] font-bold tracking-[0.05em]">
                    <span className="text-[#006a62]">{Icons.verified}</span>
                    NDPR Class-1 Audited
                  </div>
                </div>
              </div>

              {/* Hero Right - Image with Floating Cards */}
              <div className="relative mt-6 lg:mt-0">
                <div className="relative rounded-2xl overflow-hidden shadow-xl bg-[#f2f3ff]">
                  <img
                    alt="GridVault Clinical Workflow in Lagos Hospital Ward"
                    className="w-full h-auto object-cover aspect-[1.79] block"
                    src="/images/hero.png"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#283044]/40 via-transparent to-transparent pointer-events-none"></div>

                  {/* Floating Card: Emergency Override */}
                  <div className="absolute top-4 right-4 bg-white/95 backdrop-blur-md rounded-xl p-3 sm:p-4 shadow-lg max-w-[260px]">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#b6171e]"></span>
                        <span className="text-[11px] font-bold tracking-[0.05em] text-[#b6171e] uppercase">Emergency Override Active</span>
                      </div>
                      <span className="text-[11px] font-bold text-[#404752]">00:04m</span>
                    </div>
                    <p className="text-[12px] font-semibold text-[#131b2e]">Dr. O. Adeyemi - Ward 3 ICU</p>
                    <div className="flex items-center justify-between text-[12px] text-[#404752] mt-1">
                      <span>Audit ID: <strong className="font-mono text-[#131b2e]">#GV-9042</strong></span>
                      <span className="text-[#b6171e]">{Icons.crisisAlert}</span>
                    </div>
                  </div>

                  {/* Floating Card: Offline Cache */}
                  <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur-md rounded-xl p-3 sm:p-4 shadow-lg max-w-[280px]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[#006a62]">{Icons.cloudOff}</span>
                      <span className="text-[11px] font-bold tracking-[0.05em] text-[#006a62] uppercase">Sync Status: Offline Cache Active</span>
                    </div>
                    <p className="text-[12px] font-semibold text-[#131b2e]">48 patient charts queued - Zero data loss</p>
                    <div className="w-full bg-[#eaedff] rounded-full h-1.5 mt-2 overflow-hidden">
                      <div className="bg-[#006a62] h-full rounded-full w-full"></div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* IMPACT STATS BAR */}
        <section className="w-full bg-[#eaedff] border-y border-[#c0c7d4]/30">
          <div className="max-w-[1280px] mx-auto px-6 py-10">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 divide-y md:divide-y-0 md:divide-x divide-[#c0c7d4]/40">
              <div className="flex flex-col pt-4 md:pt-0 md:px-6 first:px-0">
                <span className="text-[36px] font-semibold text-[#005ea4] tracking-tight">45+</span>
                <span className="text-[12px] font-semibold text-[#131b2e] mt-1">Hospitals & Diagnostic Centers</span>
                <span className="text-[12px] text-[#404752]">Lagos, Abuja & Port Harcourt</span>
              </div>
              <div className="flex flex-col pt-4 md:pt-0 md:px-6">
                <span className="text-[36px] font-semibold text-[#006a62] tracking-tight">0.4s</span>
                <span className="text-[12px] font-semibold text-[#131b2e] mt-1">Average Record Retrieval</span>
                <span className="text-[12px] text-[#404752]">Instant chart lookup at bedside</span>
              </div>
              <div className="flex flex-col pt-4 md:pt-0 md:px-6">
                <span className="text-[36px] font-semibold text-[#005ea4] tracking-tight">100%</span>
                <span className="text-[12px] font-semibold text-[#131b2e] mt-1">NDPR & Medical Council Compliant</span>
                <span className="text-[12px] text-[#404752]">In-country cryptographic vault</span>
              </div>
              <div className="flex flex-col pt-4 md:pt-0 md:px-6">
                <span className="text-[36px] font-semibold text-[#006a62] tracking-tight">1.2M+</span>
                <span className="text-[12px] font-semibold text-[#131b2e] mt-1">Patient Records Secured</span>
                <span className="text-[12px] text-[#404752]">Cryptographically protected</span>
              </div>
            </div>
          </div>
        </section>

        {/* FEATURES SECTION */}
        <section id="features" className="w-full bg-[#faf8ff] py-16 lg:py-24">
          <div className="max-w-[1280px] mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-[26px] sm:text-[36px] font-semibold text-[#131b2e] tracking-tight mb-4">
                Clinical-Grade Security by Design
              </h2>
              <p className="text-[16px] text-[#404752] max-w-2xl mx-auto leading-relaxed">
                Built for Nigerian hospitals. Role-based access, emergency overrides, offline resilience, and tamper-proof audit logs.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-white p-8 rounded-lg border border-[#e2e7ff] shadow-sm hover:shadow-md transition-all">
                <div className="w-12 h-12 bg-[#d3e4ff] rounded-lg flex items-center justify-center mb-6 text-[#005ea4]">
                  {Icons.adminPanel}
                </div>
                <h3 className="text-[20px] font-semibold text-[#131b2e] mb-3">Role-Based Access Control</h3>
                <p className="text-[14px] text-[#404752] leading-relaxed">
                  Only authorized staff see assigned patients. Doctors, nurses, clerks and admins have isolated views based on ward and shift assignment.
                </p>
              </div>

              <div className="bg-white p-8 rounded-lg border border-[#e2e7ff] shadow-sm hover:shadow-md transition-all">
                <div className="w-12 h-12 bg-[#ffdad6] rounded-lg flex items-center justify-center mb-6 text-[#b6171e]">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L1 21h22L12 2zm0 3.5l7.5 13.5h-15L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
                  </svg>
                </div>
                <h3 className="text-[20px] font-semibold text-[#131b2e] mb-3">Emergency Override</h3>
                <p className="text-[14px] text-[#404752] leading-relaxed">
                  Instant access when time-critical. Every override is cryptographically logged with timestamp, staff ID and justification reason. Impossible to hide.
                </p>
              </div>

              <div className="bg-white p-8 rounded-lg border border-[#e2e7ff] shadow-sm hover:shadow-md transition-all">
                <div className="w-12 h-12 bg-[#84f5e8]/40 rounded-lg flex items-center justify-center mb-6 text-[#006a62]">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM3 5.27l2.28 2.28C4.48 8.7 4 9.82 4 11h2c0-.61.19-1.17.51-1.63L18.73 21 20 19.73 4.27 4 3 5.27zM19 18H7.27l9-9H19c1.65 0 3 1.35 3 3s-1.35 3-3 3z"/>
                  </svg>
                </div>
                <h3 className="text-[20px] font-semibold text-[#131b2e] mb-3">Offline Ready</h3>
                <p className="text-[14px] text-[#404752] leading-relaxed">
                  Ward power fails. Internet goes down. Your cached records stay accessible. Zero data loss. Automatic sync when connection returns.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA SECTION */}
        <section className="w-full bg-[#005ea4] py-16 lg:py-24">
          <div className="max-w-[1280px] mx-auto px-6 text-center">
            <h2 className="text-[26px] sm:text-[36px] font-semibold text-white tracking-tight mb-4">
              Ready to Secure Your Hospital's Patient Records?
            </h2>
            <p className="text-[16px] text-white/80 mb-10 max-w-2xl mx-auto leading-relaxed">
              GridVault is trusted by 45+ hospitals and diagnostic centers across Nigeria. NDPR compliant. ISO 27001 certified infrastructure.
            </p>
            <a href="/login" className="inline-flex items-center justify-center bg-white hover:bg-[#f2f3ff] text-[#005ea4] text-[14px] font-bold px-10 py-4 rounded-lg shadow-md transition-all">
              Request a Demo Today
            </a>
            <div className="flex items-center justify-center gap-6 mt-8 text-white/70 text-[12px] font-bold tracking-[0.05em] flex-wrap">
              <span className="flex items-center gap-1">
                <span className="text-white/70">{Icons.verifiedUser}</span>
                NDPR Compliant
              </span>
              <span className="text-white/30">•</span>
              <span className="flex items-center gap-1">
                <span className="text-white/70">{Icons.lock}</span>
                ISO 27001
              </span>
              <span className="text-white/30">•</span>
              <span className="flex items-center gap-1">
                <span className="text-white/70">{Icons.hub}</span>
                FMOH Standard Interoperability
              </span>
            </div>
          </div>
        </section>

      </main>

      {/* FOOTER */}
      <footer className="w-full bg-[#f2f3ff] border-t border-[#c0c7d4]/40">
        <div className="max-w-[1280px] mx-auto px-6 py-10">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 pb-10 border-b border-[#c0c7d4]/30">
            <div className="space-y-4 lg:col-span-1">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 bg-[#005ea4] rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">G</span>
                </div>
                <span className="text-[18px] font-semibold text-[#005ea4]">GridVault</span>
              </div>
              <p className="text-[12px] text-[#404752] leading-relaxed">
                Offline-first clinical infrastructure for Nigerian hospitals, multi-center health systems, and critical care units.
              </p>
              <div className="flex items-center gap-1 text-[11px] font-bold text-[#006a62]">
                <span className="text-[#006a62]">{Icons.lock}</span>
                NDPR Validated Platform
              </div>
            </div>

            <div>
              <h4 className="text-[14px] font-semibold text-[#131b2e] mb-4">Platform</h4>
              <ul className="space-y-2 text-[14px] text-[#404752]">
                <li><a href="#" className="hover:text-[#005ea4] transition-colors">Hospital Management</a></li>
                <li><a href="#" className="hover:text-[#005ea4] transition-colors">Offline Sync Node</a></li>
                <li><a href="#" className="hover:text-[#005ea4] transition-colors">EMR Telemetry</a></li>
                <li><a href="#" className="hover:text-[#005ea4] transition-colors">Enterprise Deployments</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-[14px] font-semibold text-[#131b2e] mb-4">Clinical Features</h4>
              <ul className="space-y-2 text-[14px] text-[#404752]">
                <li><a href="#" className="hover:text-[#005ea4] transition-colors">Emergency Triage Vault</a></li>
                <li><a href="#" className="hover:text-[#005ea4] transition-colors">Prescription Audits</a></li>
                <li><a href="#" className="hover:text-[#005ea4] transition-colors">Lab Integration Engine</a></li>
                <li><a href="#" className="hover:text-[#005ea4] transition-colors">ICD-11 Coding Assist</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-[14px] font-semibold text-[#131b2e] mb-4">Security & Compliance</h4>
              <ul className="space-y-2 text-[14px] text-[#404752]">
                <li><a href="#" className="hover:text-[#005ea4] transition-colors">NDPR Data Protection</a></li>
                <li><a href="#" className="hover:text-[#005ea4] transition-colors">FMOH Guidelines Sync</a></li>
                <li><a href="#" className="hover:text-[#005ea4] transition-colors">ISO 27001 Security</a></li>
                <li><a href="#" className="hover:text-[#005ea4] transition-colors">Audit Log Encryption</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-[14px] font-semibold text-[#131b2e] mb-4">Hospital Support</h4>
              <ul className="space-y-2 text-[12px] text-[#404752]">
                <li>
                  <span className="text-[11px] font-bold text-[#131b2e] block">Lagos Central Operations:</span>
                  <span>Victoria Island Hub</span>
                </li>
                <li className="pt-1">
                  <span className="text-[11px] font-bold text-[#131b2e] block">Abuja FCT Dispatch:</span>
                  <span>Central Business District</span>
                </li>
                <li className="pt-1">
                  <span className="text-[11px] font-bold text-[#005ea4] block">24/7 Clinical Hotline:</span>
                  <span>+234 1 800 GRIDVLT</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-[12px] text-[#404752]">2026 GridVault Technologies Ltd. Clinical infrastructure for Nigerian healthcare.</p>
            <div className="flex items-center gap-6 text-[12px] font-semibold text-[#404752]">
              <a href="#" className="hover:text-[#005ea4] transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-[#005ea4] transition-colors">Data Processing Agreement</a>
              <a href="#" className="hover:text-[#005ea4] transition-colors">Terms of Service</a>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}