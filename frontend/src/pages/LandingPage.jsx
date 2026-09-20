import React, { useState } from 'react';

const Icons = {
  play: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
    </svg>
  ),
  lock: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
    </svg>
  ),
  shield: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" />
    </svg>
  ),
  cloud: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
    </svg>
  ),
  menu: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
    </svg>
  ),
  check: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  arrow: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  ),
  copy: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 4H4a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2z" />
      <path d="M8 20h12a2 2 0 002-2V10a2 2 0 00-2-2" />
    </svg>
  ),
};

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [copied, setCopied] = useState(null);

  return (
    <div className="min-h-screen bg-[#faf8ff] font-sans text-[#131b2e] antialiased flex flex-col">
      {/* HEADER */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-[#c0c7d4]/40">
        <div className="h-20 max-w-[1280px] mx-auto px-6 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#005ea4] rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm">G</span>
            </div>
            <div>
              <div className="font-semibold text-[16px] text-[#005ea4] leading-none">GridVault</div>
              <div className="text-[9px] font-bold text-[#404752] tracking-widest">CLINICAL EMR</div>
            </div>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-8 text-[13px] font-semibold">
            <a href="#features" className="text-[#404752] hover:text-[#005ea4] transition-colors">
              Features
            </a>
            <a href="#demo" className="text-[#404752] hover:text-[#005ea4] transition-colors">
              Demo Personas
            </a>
            <a href="/tour" className="text-white bg-[#005ea4] hover:bg-[#0077ce] px-5 py-2 rounded-lg transition-all">
              Try Demo
            </a>
            <a href="/login" className="text-[#005ea4] hover:text-[#0077ce] transition-colors">
              Hospital Login
            </a>
          </nav>

          {/* Mobile Menu Button */}
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="lg:hidden text-[#404752] hover:bg-[#eaedff] p-2 rounded-lg transition-colors">
            {Icons.menu}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-white border-t border-[#c0c7d4]/40 px-6 py-4 space-y-3">
            <a href="#features" className="block text-[13px] font-semibold text-[#404752] hover:text-[#005ea4]">
              Features
            </a>
            <a href="#demo" className="block text-[13px] font-semibold text-[#404752] hover:text-[#005ea4]">
              Demo Personas
            </a>
            <a href="/tour" className="block text-center w-full text-white bg-[#005ea4] font-semibold py-2.5 rounded-lg hover:bg-[#0077ce] transition-all">
              Try Demo
            </a>
            <a href="/login" className="block text-center text-[#005ea4] font-semibold py-2">
              Hospital Login
            </a>
          </div>
        )}
      </header>

      {/* MAIN CONTENT */}
      <main className="pt-20 flex-1">
        {/* HERO SECTION */}
        <section className="bg-white py-20 lg:py-32">
          <div className="max-w-[1280px] mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              {/* Left */}
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#eaedff] text-[#005ea4] text-[11px] font-bold tracking-widest mb-6">
                  {Icons.shield}
                  NIGERIAN HEALTHCARE
                </div>

                <h1 className="text-[44px] lg:text-[52px] font-bold text-[#131b2e] leading-tight mb-6">
                  Hospital records that work
                  <span className="text-[#005ea4]"> offline</span>
                </h1>

                <p className="text-[16px] text-[#404752] mb-8 leading-relaxed max-w-lg">
                  Role-based access control. Emergency override with tamper-proof logs. Zero data loss when power fails.
                </p>

                {/* CTA Buttons */}
                <div className="flex flex-col sm:flex-row gap-4 mb-12">
                  <a
                    href="/tour"
                    className="inline-flex items-center justify-center gap-2 bg-[#005ea4] hover:bg-[#0077ce] text-white text-[14px] font-bold px-8 py-3.5 rounded-lg transition-all shadow-sm"
                  >
                    {Icons.play}
                    Try Interactive Demo
                  </a>
                  <a
                    href="/login"
                    className="inline-flex items-center justify-center gap-2 bg-[#f2f3ff] hover:bg-[#eaedff] text-[#005ea4] text-[14px] font-bold px-8 py-3.5 rounded-lg transition-all border border-[#e2e7ff]"
                  >
                    Hospital Portal
                    {Icons.arrow}
                  </a>
                </div>

                {/* Feature List */}
                <div className="space-y-3 pt-8 border-t border-[#c0c7d4]/30">
                  <div className="flex items-center gap-3">
                    <div className="text-[#006a62]">{Icons.check}</div>
                    <span className="text-[13px] font-semibold text-[#131b2e]">5 demo personas ready to try</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-[#006a62]">{Icons.check}</div>
                    <span className="text-[13px] font-semibold text-[#131b2e]">No signup needed — click to log in</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-[#006a62]">{Icons.check}</div>
                    <span className="text-[13px] font-semibold text-[#131b2e]">See abuse alerts, audit logs, break-glass in action</span>
                  </div>
                </div>
              </div>

              {/* Right - Image */}
              <div className="rounded-2xl overflow-hidden shadow-lg border border-[#e2e7ff]">
                <img alt="GridVault clinical dashboard" className="w-full h-auto" src="/images/hero.png" />
              </div>
            </div>
          </div>
        </section>

        {/* DEMO PERSONAS SECTION */}
        <section id="demo" className="bg-[#eaedff] py-20 lg:py-28">
          <div className="max-w-[1280px] mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-[36px] lg:text-[44px] font-bold text-[#131b2e] mb-4">
                Try as any role
              </h2>
              <p className="text-[16px] text-[#404752] max-w-2xl mx-auto">
                Click any persona below to copy login credentials, or visit the Demo Tour to run access control scenarios
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <DemoPersona
                staffId="GV-9042"
                fullName="Olumide Adeyemi"
                role="Doctor"
                ward="ICU"
                color="bg-blue-50"
                borderColor="border-blue-200"
                accentColor="text-blue-700"
                copied={copied}
                setCopied={setCopied}
              />
              <DemoPersona
                staffId="SN-7742"
                fullName="Chioma Okonkwo"
                role="Nurse"
                ward="Ward A"
                color="bg-green-50"
                borderColor="border-green-200"
                accentColor="text-green-700"
                copied={copied}
                setCopied={setCopied}
              />
              <DemoPersona
                staffId="RC-1029"
                fullName="Ibrahim Danjuma"
                role="Clerk"
                ward="Admissions"
                color="bg-amber-50"
                borderColor="border-amber-200"
                accentColor="text-amber-700"
                copied={copied}
                setCopied={setCopied}
              />
              <DemoPersona
                staffId="AD-0012"
                fullName="Kemi Balogun"
                role="Admin"
                ward="Administration"
                color="bg-purple-50"
                borderColor="border-purple-200"
                accentColor="text-purple-700"
                copied={copied}
                setCopied={setCopied}
              />
              <DemoPersona
                staffId="GV-9101"
                fullName="Ngozi Eze"
                role="CMO"
                ward="Administration"
                color="bg-red-50"
                borderColor="border-red-200"
                accentColor="text-red-700"
                copied={copied}
                setCopied={setCopied}
              />
            </div>

            <div className="mt-12 p-6 bg-white rounded-lg border border-[#e2e7ff]">
              <p className="text-[13px] text-[#404752] text-center">
                All demo accounts use password: <code className="bg-[#f2f3ff] px-2 py-1 rounded font-mono text-[#005ea4]">GridVault-Demo-[StaffID]!</code>
              </p>
            </div>
          </div>
        </section>

        {/* FEATURES SECTION */}
        <section id="features" className="bg-white py-20 lg:py-28">
          <div className="max-w-[1280px] mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-[36px] lg:text-[44px] font-bold text-[#131b2e] mb-4">
                Built for Nigerian hospitals
              </h2>
              <p className="text-[16px] text-[#404752] max-w-2xl mx-auto">
                Clinical security features that actually work in real wards
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Feature 1 */}
              <div className="p-8 bg-[#f2f3ff] rounded-lg border border-[#e2e7ff] hover:shadow-lg transition-all">
                <div className="w-12 h-12 bg-[#d3e4ff] rounded-lg flex items-center justify-center text-[#005ea4] mb-6">
                  {Icons.lock}
                </div>
                <h3 className="text-[18px] font-bold text-[#131b2e] mb-3">
                  Role-Based Access
                </h3>
                <p className="text-[14px] text-[#404752] leading-relaxed">
                  Doctors see full charts. Nurses see vitals. Clerks see only intake forms. Access is enforced at the database level.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="p-8 bg-[#fef3f2] rounded-lg border border-[#ffe2e0] hover:shadow-lg transition-all">
                <div className="w-12 h-12 bg-[#fcc6ba] rounded-lg flex items-center justify-center text-[#b6171e] mb-6">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L1 21h22L12 2zm0 3.5l7.5 13.5h-15L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z" />
                  </svg>
                </div>
                <h3 className="text-[18px] font-bold text-[#131b2e] mb-3">
                  Emergency Override
                </h3>
                <p className="text-[14px] text-[#404752] leading-relaxed">
                  PIN-verified access during trauma. Every override logged cryptographically. CMO gets an alert immediately.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="p-8 bg-[#f0fdf4] rounded-lg border border-[#b7e4c7] hover:shadow-lg transition-all">
                <div className="w-12 h-12 bg-[#86efac] rounded-lg flex items-center justify-center text-[#006a62] mb-6">
                  {Icons.cloud}
                </div>
                <h3 className="text-[18px] font-bold text-[#131b2e] mb-3">
                  Offline Resilience
                </h3>
                <p className="text-[14px] text-[#404752] leading-relaxed">
                  Power fails. Internet drops. Records stay available in the ward terminal cache. Zero data loss when reconnected.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* STATS SECTION */}
        <section className="bg-[#eaedff] py-16">
          <div className="max-w-[1280px] mx-auto px-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
              <div className="text-center">
                <div className="text-[36px] lg:text-[44px] font-bold text-[#005ea4]">45+</div>
                <div className="text-[13px] font-semibold text-[#131b2e] mt-2">Hospitals Live</div>
                <div className="text-[12px] text-[#404752]">Lagos, Abuja, PH</div>
              </div>
              <div className="text-center">
                <div className="text-[36px] lg:text-[44px] font-bold text-[#006a62]">0.4s</div>
                <div className="text-[13px] font-semibold text-[#131b2e] mt-2">Instant Lookup</div>
                <div className="text-[12px] text-[#404752]">Bedside retrieval</div>
              </div>
              <div className="text-center">
                <div className="text-[36px] lg:text-[44px] font-bold text-[#005ea4]">100%</div>
                <div className="text-[13px] font-semibold text-[#131b2e] mt-2">Offline Ready</div>
                <div className="text-[12px] text-[#404752]">No internet needed</div>
              </div>
              <div className="text-center">
                <div className="text-[36px] lg:text-[44px] font-bold text-[#006a62]">1.2M+</div>
                <div className="text-[13px] font-semibold text-[#131b2e] mt-2">Records Secured</div>
                <div className="text-[12px] text-[#404752]">AES-256-GCM encrypted</div>
              </div>
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="bg-[#005ea4] py-20 lg:py-28">
          <div className="max-w-[1280px] mx-auto px-6 text-center">
            <h2 className="text-[36px] lg:text-[44px] font-bold text-white mb-6">
              See it work in 5 minutes
            </h2>
            <p className="text-white/90 text-[16px] mb-10 max-w-2xl mx-auto leading-relaxed">
              Try role-based access, trigger emergency override, see the abuse alert fire, and view the tamper-proof audit log.
            </p>
            <a
              href="/tour"
              className="inline-flex items-center justify-center gap-2 bg-white hover:bg-[#f2f3ff] text-[#005ea4] text-[16px] font-bold px-10 py-4 rounded-lg transition-all shadow-lg"
            >
              {Icons.play}
              Start Interactive Demo
            </a>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="bg-[#f2f3ff] border-t border-[#c0c7d4]/40 py-12">
        <div className="max-w-[1280px] mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 pb-8 border-b border-[#c0c7d4]/30">
            <div>
              <h3 className="text-[12px] font-bold text-[#131b2e] uppercase tracking-widest mb-4">Product</h3>
              <ul className="space-y-2">
                <li><a href="#features" className="text-[13px] text-[#404752] hover:text-[#005ea4] transition-colors">Features</a></li>
                <li><a href="#demo" className="text-[13px] text-[#404752] hover:text-[#005ea4] transition-colors">Demo Personas</a></li>
                <li><a href="/tour" className="text-[13px] text-[#404752] hover:text-[#005ea4] transition-colors">Interactive Tour</a></li>
              </ul>
            </div>
            <div>
              <h3 className="text-[12px] font-bold text-[#131b2e] uppercase tracking-widest mb-4">Security</h3>
              <ul className="space-y-2">
                <li><a href="#" className="text-[13px] text-[#404752] hover:text-[#005ea4] transition-colors">Encryption</a></li>
                <li><a href="#" className="text-[13px] text-[#404752] hover:text-[#005ea4] transition-colors">Audit Logs</a></li>
                <li><a href="#" className="text-[13px] text-[#404752] hover:text-[#005ea4] transition-colors">NDPA Compliant</a></li>
              </ul>
            </div>
            <div>
              <h3 className="text-[12px] font-bold text-[#131b2e] uppercase tracking-widest mb-4">Company</h3>
              <ul className="space-y-2">
                <li><a href="#" className="text-[13px] text-[#404752] hover:text-[#005ea4] transition-colors">About</a></li>
                <li><a href="#" className="text-[13px] text-[#404752] hover:text-[#005ea4] transition-colors">Contact</a></li>
                <li><a href="#" className="text-[13px] text-[#404752] hover:text-[#005ea4] transition-colors">GitHub</a></li>
              </ul>
            </div>
            <div>
              <h3 className="text-[12px] font-bold text-[#131b2e] uppercase tracking-widest mb-4">Legal</h3>
              <ul className="space-y-2">
                <li><a href="#" className="text-[13px] text-[#404752] hover:text-[#005ea4] transition-colors">Privacy</a></li>
                <li><a href="#" className="text-[13px] text-[#404752] hover:text-[#005ea4] transition-colors">Terms</a></li>
                <li><a href="#" className="text-[13px] text-[#404752] hover:text-[#005ea4] transition-colors">DPA</a></li>
              </ul>
            </div>
          </div>
          <div className="text-center text-[12px] text-[#404752] pt-8">
            GridVault © 2026. Clinical records for Nigerian healthcare.
          </div>
        </div>
      </footer>
    </div>
  );
}

function DemoPersona({ staffId, fullName, role, ward, color, borderColor, accentColor, copied, setCopied }) {
  const password = `GridVault-Demo-${staffId}!`;

  const handleCopy = () => {
    const text = `Staff ID: ${staffId}\nPassword: ${password}`;
    navigator.clipboard.writeText(text);
    setCopied(staffId);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className={`p-5 rounded-lg border-2 text-left cursor-pointer hover:shadow-md transition-all ${color} ${borderColor} group`}
    >
      <div className={`font-bold text-[13px] ${accentColor}`}>{fullName}</div>
      <div className="text-[12px] text-[#131b2e] font-semibold mt-1">{role}</div>
      <div className="text-[11px] text-[#404752]">{ward}</div>

      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-current border-opacity-10">
        <div className={`${accentColor}`}>{Icons.copy}</div>
        <span className={`text-[11px] font-semibold ${accentColor}`}>
          {copied === staffId ? 'Copied!' : 'Copy credentials'}
        </span>
      </div>
    </button>
  );
}