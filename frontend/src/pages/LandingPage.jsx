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
      <nav className="relative z-10 flex justify-between items-center px-6 py-4 border-b border-slate-700/30">
        <div className="text-xl font-semibold tracking-tight">GridVault</div>
        <a href="/login" className="px-4 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/50 text-sm hover:bg-emerald-600/30 transition-colors">
          Clinical Portal
        </a>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 px-6 py-24 max-w-4xl mx-auto">
        <div className="space-y-8 animate-fade-in">
          {/* Icon */}
          <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
            <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2c6.627 0 12 4.477 12 10s-5.373 10-12 10S0 17.523 0 12 5.373 2 12 2z"/>
              <path d="M8 12h8M12 8v8" strokeLinecap="round"/>
            </svg>
          </div>

          {/* Headline */}
          <div className="space-y-4">
            <h1 className="text-5xl md:text-6xl font-bold leading-tight tracking-tight">
              Offline-First EMR
              <br />
              <span className="text-emerald-400">Built for Nigerian Hospitals</span>
            </h1>
            <p className="text-lg text-slate-300 max-w-2xl leading-relaxed">
              Zero-latency clinical records. Tamper-proof audit logs. Emergency access in seconds. Survives blackouts, grid failures, and hostile intrusions.
            </p>
          </div>

          {/* CTA */}
          <div className="flex gap-4 pt-4">
            <a href="/login" className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 rounded-lg font-medium transition-colors">
              Launch Demo
            </a>
            <a href="#features" className="px-6 py-3 border border-slate-600 hover:border-slate-400 rounded-lg font-medium transition-colors">
              Learn How It Works
            </a>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-3 gap-6 pt-12 border-t border-slate-700/30">
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
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="relative z-10 px-6 py-20 max-w-5xl mx-auto">
        <div className="space-y-16">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-emerald-400 tracking-wide uppercase">Core Capabilities</div>
            <h2 className="text-4xl font-bold">Built for Crisis</h2>
          </div>

          {/* Feature 1: RBAC */}
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-lg bg-blue-500/20 border border-blue-500/40 flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
              </div>
              <h3 className="text-2xl font-bold">Role-Based Access Control</h3>
              <p className="text-slate-300 leading-relaxed">
                Doctors see full dossiers. Nurses see vitals and handovers. Clerks see demographics only. Each role gets exactly what they need—nothing more.
              </p>
              <div className="flex gap-3 pt-2 text-sm text-slate-400">
                <span>Ward isolation</span>
                <span className="text-slate-600">•</span>
                <span>Shift scoping</span>
                <span className="text-slate-600">•</span>
                <span>Field encryption</span>
              </div>
            </div>
            <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20 rounded-xl p-8 hidden md:flex items-center justify-center h-64">
              <svg className="w-32 h-32 text-blue-400/50" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="50" cy="30" r="12" />
                <rect x="38" y="50" width="24" height="35" rx="2" />
                <circle cx="25" cy="30" r="10" />
                <path d="M 15 50 L 20 55 L 20 80" />
                <circle cx="75" cy="30" r="10" />
                <path d="M 85 50 L 80 55 L 80 80" />
              </svg>
            </div>
          </div>

          {/* Feature 2: Break Glass */}
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="bg-gradient-to-br from-red-500/10 to-red-600/5 border border-red-500/20 rounded-xl p-8 hidden md:flex items-center justify-center h-64">
              <svg className="w-32 h-32 text-red-400/50" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="20" y="20" width="60" height="60" rx="4" />
                <line x1="35" y1="35" x2="65" y2="65" />
                <line x1="65" y1="35" x2="35" y2="65" />
                <circle cx="50" cy="50" r="8" fill="none" />
              </svg>
            </div>
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-lg bg-red-500/20 border border-red-500/40 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11 1h2v4h-2V1m0 16h2v4h-2v-4m6.3-2.8l1.4-1.4L21 18l-2.3 2.3-1.4-1.4m-9.6 0l1.4 1.4L3 20.3 5.3 18l-1.4-1.4"/>
                </svg>
              </div>
              <h3 className="text-2xl font-bold">Emergency Override (Break-Glass)</h3>
              <p className="text-slate-300 leading-relaxed">
                One tap. Trauma case? Unassigned patient? Instant access. CMO gets alerted immediately. Every override is cryptographically signed and impossible to hide.
              </p>
              <div className="flex gap-3 pt-2 text-sm text-slate-400">
                <span>Instant unlock</span>
                <span className="text-slate-600">•</span>
                <span>CMO alert</span>
                <span className="text-slate-600">•</span>
                <span>Immutable audit</span>
              </div>
            </div>
          </div>

          {/* Feature 3: Offline */}
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                <svg className="w-6 h-6 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2c6.627 0 12 5.373 12 12s-5.373 12-12 12S0 20.627 0 14 5.373 2 12 2z"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
              </div>
              <h3 className="text-2xl font-bold">100% Offline-First</h3>
              <p className="text-slate-300 leading-relaxed">
                Blackout hits. Internet fails. Generator switches. Doesn't matter. 48+ patient charts cached locally. All vitals, notes, MAR entries queued and synced when you reconnect.
              </p>
              <div className="flex gap-3 pt-2 text-sm text-slate-400">
                <span>Zero data loss</span>
                <span className="text-slate-600">•</span>
                <span>Auto sync</span>
                <span className="text-slate-600">•</span>
                <span>Network resilient</span>
              </div>
            </div>
            <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20 rounded-xl p-8 hidden md:flex items-center justify-center h-64">
              <svg className="w-32 h-32 text-amber-400/50" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="20" y="15" width="60" height="70" rx="3" />
                <line x1="30" y1="30" x2="70" y2="30" />
                <line x1="30" y1="42" x2="70" y2="42" />
                <line x1="30" y1="54" x2="70" y2="54" />
                <circle cx="50" cy="75" r="4" fill="currentColor" />
              </svg>
            </div>
          </div>

          {/* Feature 4: Ledger */}
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20 rounded-xl p-8 hidden md:flex items-center justify-center h-64">
              <svg className="w-32 h-32 text-purple-400/50" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M30 20h40v60H30z" />
                <line x1="30" y1="32" x2="70" y2="32" />
                <line x1="30" y1="42" x2="70" y2="42" />
                <line x1="30" y1="52" x2="70" y2="52" />
                <line x1="30" y1="62" x2="50" y2="62" />
                <path d="M60 55 L65 60 L75 50" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-lg bg-purple-500/20 border border-purple-500/40 flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                </svg>
              </div>
              <h3 className="text-2xl font-bold">Tamper-Proof Audit Ledger</h3>
              <p className="text-slate-300 leading-relaxed">
                Hash-chained cryptographic log. Every access, override, and abuse detection event is signed. Even if the database is stolen, log tampering is mathematically impossible to hide.
              </p>
              <div className="flex gap-3 pt-2 text-sm text-slate-400">
                <span>Append-only</span>
                <span className="text-slate-600">•</span>
                <span>Hash chain</span>
                <span className="text-slate-600">•</span>
                <span>Cryptographic proof</span>
              </div>
            </div>
          </div>

          {/* Feature 5: Compliance */}
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-lg bg-teal-500/20 border border-teal-500/40 flex items-center justify-center">
                <svg className="w-6 h-6 text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1v22m-8.3-6.7l15.6-15.6M3.5 10.5h17M6.2 3.2l15.6 15.6"/>
                </svg>
              </div>
              <h3 className="text-2xl font-bold">In-Country Data Sovereignty</h3>
              <p className="text-slate-300 leading-relaxed">
                Patient records stored on servers in Lagos and Abuja only. NDPR Class-1 audited. FMOH v2.4 interoperable. Zero foreign data brokers. Your patients' data stays in Nigeria.
              </p>
              <div className="flex gap-3 pt-2 text-sm text-slate-400">
                <span>Dual clusters</span>
                <span className="text-slate-600">•</span>
                <span>NDPR compliant</span>
                <span className="text-slate-600">•</span>
                <span>FMOH compatible</span>
              </div>
            </div>
            <div className="bg-gradient-to-br from-teal-500/10 to-teal-600/5 border border-teal-500/20 rounded-xl p-8 hidden md:flex items-center justify-center h-64">
              <svg className="w-32 h-32 text-teal-400/50" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="50" cy="50" r="35" />
                <path d="M50 20 L65 35 L60 50 L70 60 L50 70 L30 60 L40 50 L35 35 Z" />
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* Abuse Detection Section */}
      <section className="relative z-10 px-6 py-20 max-w-5xl mx-auto border-t border-slate-700/30">
        <div className="space-y-12">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-emerald-400 tracking-wide uppercase">Security</div>
            <h2 className="text-4xl font-bold">Detects Real Abuse</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              { title: "Clerk Clinical Probe", desc: "Detects when records staff access clinical fields they shouldn't" },
              { title: "Off-Ward Access", desc: "Flags staff viewing patients outside their assigned ward" },
              { title: "Off-Shift Access", desc: "Catches unauthorized access during off-duty hours" },
              { title: "Break-Glass Spike", desc: "Alerts on unusual emergency override frequency" },
              { title: "Admin Reach", desc: "Prevents system admins from accessing patient data" },
              { title: "Bulk Enumeration", desc: "Stops rapid sequential patient record lookups" },
              { title: "Sensitive Sweep", desc: "Blocks mass requests for HIV/genotype fields" },
              { title: "Credential Stuffing", desc: "Detects login attack patterns and rate-limits" },
              { title: "Refresh Reuse", desc: "Prevents stolen token replay attacks" },
            ].map((item, i) => (
              <div key={i} className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-6 hover:border-slate-600/70 hover:bg-slate-800/60 transition-all">
                <h4 className="font-semibold text-sm mb-2">{item.title}</h4>
                <p className="text-sm text-slate-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compliance Section */}
      <section className="relative z-10 px-6 py-20 max-w-5xl mx-auto border-t border-slate-700/30">
        <div className="space-y-12">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-emerald-400 tracking-wide uppercase">Trust & Compliance</div>
            <h2 className="text-4xl font-bold">Built for Regulation</h2>
          </div>

          <div className="flex flex-wrap gap-4">
            {[
              { label: "NDPR Class-1", icon: "✓" },
              { label: "ISO 27001", icon: "✓" },
              { label: "FMOH v2.4", icon: "✓" },
              { label: "1400+ Tests", icon: "✓" },
            ].map((item, i) => (
              <div key={i} className="px-6 py-3 bg-slate-800/40 border border-slate-700/50 rounded-lg flex items-center gap-3">
                <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
                <span className="text-sm font-medium">{item.label}</span>
              </div>
            ))}
          </div>

          <p className="text-slate-400 max-w-2xl">
            Comprehensive threat modeling. Cryptographic proof of audit trail integrity. Offline resilience tested under real grid blackouts. Open-source auditable design.
          </p>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative z-10 px-6 py-20 max-w-5xl mx-auto border-t border-slate-700/30">
        <div className="bg-gradient-to-br from-emerald-600/20 to-emerald-700/10 border border-emerald-500/30 rounded-xl p-12 space-y-6">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold">Ready to Transform Clinical Care?</h2>
            <p className="text-slate-300">Launch the demo. See role-based access, break-glass override, and offline sync in action.</p>
          </div>
          <div className="flex flex-wrap gap-4">
            <a href="/login" className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 rounded-lg font-medium transition-colors">
              Launch Clinical Portal
            </a>
            <a href="#" className="px-6 py-3 border border-emerald-500/50 hover:border-emerald-400 rounded-lg font-medium transition-colors">
              View Architecture Docs
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 px-6 py-12 border-t border-slate-700/30 max-w-5xl mx-auto">
        <div className="flex justify-between items-center">
          <p className="text-sm text-slate-400">GridVault v1.0.0 — Sovereign Clinical EMR</p>
          <div className="flex gap-6 text-sm text-slate-400">
            <a href="#" className="hover:text-slate-300 transition-colors">Threat Model</a>
            <a href="#" className="hover:text-slate-300 transition-colors">Compliance</a>
            <a href="#" className="hover:text-slate-300 transition-colors">API Docs</a>
          </div>
        </div>
      </footer>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .animate-fade-in {
          animation: fadeIn 0.8s ease-out;
        }
      `}</style>
    </div>
  );
}