import { NavLink, Outlet } from 'react-router-dom';

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
          isActive
            ? 'bg-accent/15 text-accent-hover'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
        }`
      }
    >
      {label}
    </NavLink>
  );
}

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <NavLink to="/" className="flex items-center gap-2.5 group">
              <div className="w-7 h-7 rounded-md bg-accent/15 border border-accent/30 flex items-center justify-center group-hover:bg-accent/25 transition-colors">
                <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-slate-200 tracking-tight">
                MedVerify
              </span>
            </NavLink>

            <div className="flex items-center gap-1">
              <NavItem to="/" label="Search" />
              <NavItem to="/records" label="Records" />
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono text-slate-600">
            <span className="w-1.5 h-1.5 rounded-full bg-risk-low animate-pulse" />
            Connected
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/50 py-4">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between text-xs text-slate-600 font-mono">
          <span>Medical Provider Verifier v1.0</span>
          <span>Internal Use Only</span>
        </div>
      </footer>
    </div>
  );
}