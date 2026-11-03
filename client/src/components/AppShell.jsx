import { NavLink, useLocation } from 'react-router-dom';
import { Activity, ArrowUpRight, BarChart3, Clock3, Gauge, Globe2, Grid2X2, Settings2, Sparkles } from 'lucide-react';

const links = [
  { to: '/dashboard', label: 'Overview', icon: BarChart3 },
  { to: '/scan', label: 'Website scanner', icon: Gauge },
  { to: '/history', label: 'Recent scans', icon: Clock3 },
  { to: '/settings', label: 'Settings', icon: Settings2 },
];

const titleMap = {
  '/dashboard': 'Overview',
  '/scan': 'Website scanner',
  '/history': 'Recent scans',
  '/settings': 'Settings',
};

export default function AppShell({ children }) {
  const location = useLocation();
  const path = location.pathname.startsWith('/reports/') ? 'Audit report' : (titleMap[location.pathname] ?? 'SiteSense AI');
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <NavLink to="/dashboard" className="brand-lockup">
          <span className="brand-mark"><Activity size={19} strokeWidth={2.4} /></span>
          <span>SiteSense<span className="brand-ai"> AI</span></span>
        </NavLink>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} title={label} aria-label={label} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
              <Icon size={17} strokeWidth={1.8} /> <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note-icon"><Sparkles size={16} /></div>
          <div>
            <p className="sidebar-note-title">Better pages start here.</p>
            <p className="sidebar-note-copy">Run a fresh audit to see what needs attention.</p>
          </div>
          <NavLink to="/scan" className="sidebar-cta" aria-label="Start a new scan"><ArrowUpRight size={16} /></NavLink>
        </div>
        <div className="sidebar-footer"><Globe2 size={14} /> Website intelligence</div>
      </aside>
      <main className="workspace-main">
        <header className="topbar">
          <div className="topbar-title"><span className="crumb">SiteSense AI</span><span className="crumb-slash">/</span><span>{path}</span></div>
          <div className="topbar-actions">
            <NavLink to="/" className="button button-secondary button-small portal-link"><Grid2X2 size={14} /><span>All projects</span></NavLink>
            <NavLink to="/scan" className="button button-primary button-small"><Gauge size={15} /> New scan</NavLink>
          </div>
        </header>
        <div className="workspace-content">{children}</div>
      </main>
    </div>
  );
}
