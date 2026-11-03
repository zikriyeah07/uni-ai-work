import { Link, NavLink } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';

const links = [
  { to: '/cv-checker', label: 'CV Checker' },
  { to: '/roadmap-generator', label: 'Roadmap' },
  { to: '/sitesense', label: 'SiteSense' },
];

export default function ToolHeader({ active }) {
  return (
    <header className="tool-header">
      <Link to="/" className="tool-brand"><span className="hub-brand-mark"><Sparkles size={17} /></span><span>Applied AI <b>Project Lab</b></span></Link>
      <nav className="tool-switcher" aria-label="Projects">
        {links.map(({ to, label }) => <NavLink key={to} to={to} className={active === to ? 'tool-switch-active' : ''}>{label}</NavLink>)}
      </nav>
      <Link to="/" className="tool-back"><ArrowLeft size={15} /><span>All projects</span></Link>
    </header>
  );
}
