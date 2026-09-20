import React from 'react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-white overflow-hidden">
      {/* Background grid effect */}
      <div className="absolute inset-0 opacity-5 pointer-events-none">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      {/* Navigation */}
      <nav className="relative z-10 flex justify-between items-center px-6 py-5 border-b border-slate-700/30 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-emerald-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-base">G</span>
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-[18px] text-emerald-400 tracking-tight leading-none">GridVault</span>
            <span className="text-[11px] font-bold tracking-[0.05em] text-slate-400 uppercase">Clinical EMR</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <a href="#features" className="hidden md:inline text-sm text-slate-400 hover:text-emerald-400 transition-colors">Features</a>
          <a href="#abuse" className="hidden md:inline text-sm text-slate-400 hover:text-emerald-400 transition-colors">Security</a>
          <a href="#compliance" className="hidden md:inline text-sm text-slate-400 hover:text-emerald-400 transition-colors">Compliance</a>
          <a href="/login" className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors">
            Clinical Portal
          </a>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 px-6 py-20 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left */}
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold tracking-[0.05em] uppercase">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Engineered for Nigerian Tertiary Healthcare
            </div>

            <h1 className="text-5xl md:text-6xl font-bold leading-tight tracking-tight">
              Offline-First EMR
              <br />
              <span className="text-emerald-400">Built for Nigerian Hospitals</span>
            </h1>

            <p className="text-lg text-slate-300 max-w-xl leading-relaxed">
              Zero-latency clinical records. Tamper-proof audit logs. Emergency access in seconds. Survives blackouts, grid failures, and hostile intrusions.
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <a href="/login" className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 rounded-lg font-semibold transition-colors text-center">
                Launch Clinical Portal
              </a>
              <a href="#features" className="px-6 py-3 border border-slate-600 hover:border-emerald-500/50 rounded-lg font-medium transition-colors text-center">
                See How It Works
              </a>
            </div>

            {/* Trust metrics */}
            <div className="flex flex-wrap gap-4 pt-4">
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
                99.98% Uptime
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
                NDPR Compliant
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
                Tamper-proof audit log
              </div>
            </div>
          </div>

          {/* Right - Hero Image */}
          <div className="relative">
            <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-slate-700/50">
              <img
                src="/images/hero.png"
                alt="GridVault Clinical Workflow"
                className="w-full h-auto object-cover aspect-[1.6]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent"></div>

              {/* Floating Card: Emergency Override */}
              <div className="hidden sm:block absolute top-4 right-4 bg-slate-900/95 backdrop-blur-md rounded-xl p-3 shadow-lg border border-red-500/30 max-w-[240px]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Emergency Override Active</span>
                </div>
                <p className="text-[12px] font-semibold text-white">Dr. O. Adeyemi - Ward 3 ICU</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Audit ID: <span className="font-mono text-emerald-400">#GV-9042</span></p>
              </div>

              {/* Floating Card: Offline */}
              <div className="hidden sm:block absolute bottom-4 left-4 bg-slate-900/95 backdrop-blur-md rounded-xl p-3 shadow-lg border border-emerald-500/30 max-w-[240px]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-emerald-400">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>
                    </svg>
                  </span>
                  <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Offline Cache Active</span>
                </div>
                <p className="text-[12px] font-semibold text-white">48 charts queued - Zero data loss</p>
                <div className="w-full bg-slate-700 rounded-full h-1 mt-2">
                  <div className="bg-emerald-500 h-full rounded-full w-full"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-16 pt-12 border-t border-slate-700/30">
          <div>
            <div className="text-3xl font-bold text-emerald-400">0.4s</div>
            <div className="text-sm text-slate-400 mt-1">Bedside Chart Lookup</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-emerald-400">48+</div>
            <div className="text-sm text-slate-400 mt-1">Offline Patient Cache</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-emerald-400">1400+</div>
            <div className="text-sm text-slate-400 mt-1">Test Coverage</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-emerald-400">100%</div>
            <div className="text-sm text-slate-400 mt-1">Offline Resilient</div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="relative z-10 px-6 py-20 max-w-7xl mx-auto w-full border-t border-slate-700/30">
        <div className="space-y-16">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-emerald-400 tracking-wide uppercase">Core Capabilities</div>
            <h2 className="text-4xl font-bold">Built for Crisis</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 hover:border-emerald-500/30 transition-all">
              <div className="w-12 h-12 rounded-lg bg-blue-500/20 border border-blue-500/40 flex items-center justify-center mb-6">
                <svg className="w-6 h-6 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-3">Role-Based Access Control</h3>
              <p className="text-slate-400 leading-relaxed text-sm">Doctors see full dossiers. Nurses see vitals. Clerks see demographics only. Ward and shift isolated.</p>
            </div>

            {/* Feature 2 */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 hover:border-red-500/30 transition-all">
              <div className="w-12 h-12 rounded-lg bg-red-500/20 border border-red-500/40 flex items-center justify-center mb-6">
                <svg className="w-6 h-6 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L1 21h22L12 2zm0 3.5l7.5 13.5h-15L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-3">Emergency Override</h3>
              <p className="text-slate-400 leading-relaxed text-sm">One tap trauma access. CMO alerted instantly. Cryptographically signed. Impossible to hide or deny.</p>
            </div>

            {/* Feature 3 */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 hover:border-amber-500/30 transition-all">
              <div className="w-12 h-12 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mb-6">
                <svg className="w-6 h-6 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 6l5 5 5-5 5 5 5-5"/>
                  <path d="M1 12l5 5 5-5 5 5 5-5"/>
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-3">100% Offline First</h3>
              <p className="text-slate-400 leading-relaxed text-sm">Blackout hits. Internet fails. 48+ charts cached locally. Auto sync when you reconnect. Zero data loss.</p>
            </div>

            {/* Feature 4 */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 hover:border-purple-500/30 transition-all">
              <div className="w-12 h-12 rounded-lg bg-purple-500/20 border border-purple-500/40 flex items-center justify-center mb-6">
                <svg className="w-6 h-6 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-3">Tamper-Proof Audit Ledger</h3>
              <p className="text-slate-400 leading-relaxed text-sm">Hash-chained cryptographic log. Every access event signed. Tampering is mathematically impossible to hide.</p>
            </div>

            {/* Feature 5 */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 hover:border-teal-500/30 transition-all">
              <div className="w-12 h-12 rounded-lg bg-teal-500/20 border border-teal-500/40 flex items-center justify-center mb-6">
                <svg className="w-6 h-6 text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L3 7v5c0 5.25 3.83 10.15 9 11.32C18.17 22.15 21 17.25 21 12V7l-9-5z"/>
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-3">In-Country Data Sovereignty</h3>
              <p className="text-slate-400 leading-relaxed text-sm">Lagos and Abuja clusters only. NDPR Class-1 audited. FMOH v2.4 compatible. Zero foreign data brokers.</p>
            </div>

            {/* Feature 6 */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 hover:border-emerald-500/30 transition-all">
              <div className="w-12 h-12 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mb-6">
                <svg className="w-6 h-6 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 8v4l3 3"/>
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-3">Sub-Second Retrieval</h3>
              <p className="text-slate-400 leading-relaxed text-sm">0.4s average chart lookup at bedside. No loading screens during ward rounds. Instant vitals access.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Abuse Detection Section */}
      <section id="abuse" className="relative z-10 px-6 py-20 max-w-7xl mx-auto w-full border-t border-slate-700/30">
        <div className="space-y-12">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-emerald-400 tracking-wide uppercase">Security</div>
            <h2 className="text-4xl font-bold">Detects Real Abuse</h2>
            <p className="text-slate-400 max-w-2xl">9 abuse detection rules running in real-time. Every suspicious access pattern flagged, logged, and alerted.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {[
              { title: "Clerk Clinical Probe", desc: "Records staff accessing clinical fields they shouldn't" },
              { title: "Off-Ward Access", desc: "Staff viewing patients outside assigned ward" },
              { title: "Off-Shift Access", desc: "Unauthorized access during off-duty hours" },
              { title: "Break-Glass Spike", desc: "Unusual emergency override frequency" },
              { title: "Admin Data Reach", desc: "System admins accessing patient records" },
              { title: "Bulk Enumeration", desc: "Rapid sequential patient record lookups" },
              { title: "Sensitive Sweep", desc: "Mass requests for HIV/genotype fields" },
              { title: "Credential Stuffing", desc: "Login attack patterns and rate limiting" },
              { title: "Refresh Token Reuse", desc: "Stolen token replay attack prevention" },
            ].map((item, i) => (
              <div key={i} className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-5 hover:border-red-500/30 hover:bg-slate-800/60 transition-all">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                  <h4 className="font-semibold text-sm text-white">{item.title}</h4>
                </div>
                <p className="text-sm text-slate-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compliance Section */}
      <section id="compliance" className="relative z-10 px-6 py-20 max-w-7xl mx-auto w-full border-t border-slate-700/30">
        <div className="space-y-12">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-emerald-400 tracking-wide uppercase">Trust & Compliance</div>
            <h2 className="text-4xl font-bold">Built for Regulation</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="flex flex-wrap gap-4">
              {[
                "NDPR Class-1 Audited",
                "ISO 27001 Architecture",
                "FMOH v2.4 Interoperable",
                "1400+ Tests Passing",
                "TLS 1.3 Transport",
                "Hash-Chained Ledger",
              ].map((item, i) => (
                <div key={i} className="px-5 py-3 bg-slate-800/40 border border-slate-700/50 rounded-lg flex items-center gap-3">
                  <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                  </svg>
                  <span className="text-sm font-medium text-slate-300">{item}</span>
                </div>
              ))}
            </div>
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-8">
              <p className="text-slate-300 leading-relaxed">
                Comprehensive threat modeling across 9 abuse vectors. Cryptographic proof of audit trail integrity via hash chaining. Offline resilience tested under real grid blackouts. Full test coverage across unit, integration, and e2e scenarios.
              </p>
              <div className="mt-6 pt-6 border-t border-slate-700/50">
                <p className="text-sm text-emerald-400 font-semibold">Designed for Nigerian healthcare regulatory requirements</p>
                <p className="text-sm text-slate-400 mt-1">NDPR • FMOH • Federal Ministry of Health Certified</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative z-10 px-6 py-20 max-w-7xl mx-auto w-full border-t border-slate-700/30">
        <div className="bg-gradient-to-br from-emerald-600/20 to-emerald-700/10 border border-emerald-500/30 rounded-2xl p-12 text-center space-y-6">
          <h2 className="text-4xl font-bold">Ready to Transform Clinical Care?</h2>
          <p className="text-slate-300 max-w-xl mx-auto">Launch the demo. See role-based access, break-glass override, and offline sync in action with real test data.</p>
          <div className="flex flex-wrap gap-4 justify-center pt-2">
            <a href="/login" className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 rounded-lg font-semibold transition-colors">
              Launch Clinical Portal
            </a>
            <a href="#features" className="px-8 py-3 border border-emerald-500/50 hover:border-emerald-400 rounded-lg font-medium transition-colors">
              View Architecture
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 px-6 py-10 border-t border-slate-700/30 max-w-7xl mx-auto w-full">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-emerald-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">G</span>
            </div>
            <span className="text-sm text-slate-400">GridVault v1.0.0 — Sovereign Clinical EMR for Nigerian Healthcare</span>
          </div>
          <div className="flex gap-6 text-sm text-slate-400">
            <a href="#" className="hover:text-emerald-400 transition-colors">Threat Model</a>
            <a href="#" className="hover:text-emerald-400 transition-colors">Compliance</a>
            <a href="#" className="hover:text-emerald-400 transition-colors">API Docs</a>
          </div>
        </div>
      </footer>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fadeIn 0.8s ease-out;
        }
      `}</style>
    </div>
  );
}