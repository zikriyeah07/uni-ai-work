import { Link } from 'react-router-dom';
import { Activity, ArrowRight, ArrowUpRight, FileText, Route, Sparkles } from 'lucide-react';

const projects = [
  {
    number: '01',
    title: 'AI CV Checker',
    description: 'Upload a CV to get an AI assessment, strengths, and specific improvements grounded in the document.',
    detail: 'PDF or text file',
    path: '/cv-checker',
    icon: FileText,
    label: 'CAREER TOOL',
  },
  {
    number: '02',
    title: 'AI Roadmap Generator',
    description: 'Turn a goal and time period into a practical sequence of milestones, tasks, and deliverables.',
    detail: 'Personalized learning plan',
    path: '/roadmap-generator',
    icon: Route,
    label: 'PLANNING TOOL',
  },
  {
    number: '03',
    title: 'SiteSense AI',
    description: 'Audit a public website with real technical checks and PageSpeed data, then review prioritized fixes.',
    detail: 'SEO and performance audit',
    path: '/sitesense',
    icon: Activity,
    label: 'WEB ANALYSIS TOOL',
  },
];

export default function ProjectHub() {
  return (
    <div className="hub-page">
      <header className="hub-header">
        <Link to="/" className="hub-brand">
          <span className="hub-brand-mark"><Sparkles size={18} strokeWidth={2.1} /></span>
          <span>Applied AI <b>Project Lab</b></span>
        </Link>
        <span className="hub-header-note">University project suite</span>
      </header>
      <main className="hub-main">
        <section className="hub-intro">
          <div className="hub-kicker"><span /> PROJECT SHOWCASE</div>
          <div className="hub-intro-grid">
            <h1>Three tools.<br /><span>One workspace.</span></h1>
            <div className="hub-intro-copy">
              <p>Choose a project to get started. Each tool uses AI to turn your input into a practical analysis or plan.</p>
              <span>CV review&nbsp; / &nbsp;Roadmaps&nbsp; / &nbsp;Website audits</span>
            </div>
          </div>
        </section>
        <section className="hub-project-grid" aria-label="Available projects">
          {projects.map(({ number, title, description, detail, path, icon: Icon, label }) => (
            <article className={`hub-project-card hub-project-${number}`} key={path}>
              <div className="hub-card-top">
                <span className="hub-card-number">{number}</span>
                <span className="hub-card-icon"><Icon size={20} strokeWidth={1.8} /></span>
              </div>
              <div className="hub-card-label">{label}</div>
              <h2>{title}</h2>
              <p>{description}</p>
              <div className="hub-card-bottom">
                <span>{detail}</span>
                <Link to={path} className="hub-open-link">Open project <ArrowUpRight size={16} /></Link>
              </div>
            </article>
          ))}
        </section>
        <div className="hub-note"><span className="hub-note-rule" /><p>Start with the tool that matches the work you want to do.</p><ArrowRight size={15} /></div>
      </main>
      <footer className="hub-footer">
        <span>Applied AI Project Lab</span>
        <span>CV review · Goal planning · Website analysis</span>
      </footer>
    </div>
  );
}
