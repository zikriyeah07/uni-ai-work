import { Link, useNavigate } from 'react-router-dom';
import { Activity, ArrowDown, ArrowRight, Check, Gauge, Globe2, SearchCheck, ShieldCheck, Sparkles } from 'lucide-react';
import ScanForm from '../components/ScanForm.jsx';

export default function Landing() {
  const navigate = useNavigate();
  return (
    <div className="landing-page">
      <header className="landing-nav">
        <Link className="brand-lockup landing-brand" to="/">
          <span className="brand-mark"><Activity size={19} strokeWidth={2.4} /></span>
          <span>SiteSense<span className="brand-ai"> AI</span></span>
        </Link>
        <nav className="landing-links">
          <a href="#features">Features</a><a href="#how-it-works">How it works</a>
          <button className="landing-signin" onClick={() => navigate('/dashboard')}>Open dashboard <ArrowRight size={15} /></button>
        </nav>
      </header>
      <section className="landing-hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> WEBSITE AUDITS, MADE CLEAR</div>
          <h1>Your Website<br /><span>Deserves Better.</span></h1>
          <p className="hero-lede">Find what is slowing your site down, holding back search visibility, and making pages harder to use. Get a clear plan to improve it.</p>
          <ScanForm compact onComplete={(scan) => navigate(scan.id ? `/reports/${scan.id}` : '/reports/latest', { state: { scan } })} />
          <div className="hero-footnote"><ShieldCheck size={15} /> Public pages only. Your API keys stay on your server.</div>
        </div>
        <div className="hero-visual" aria-label="Website audit categories">
          <div className="audit-sheet">
            <div className="sheet-header"><div className="sheet-brand"><span className="tiny-mark"><Activity size={13} /></span> Site audit</div><span className="sheet-device">MOBILE</span></div>
            <div className="sheet-url"><Globe2 size={14} /> Your page URL</div>
            <div className="sheet-score-row">
              <div className="sheet-score-ring"><div><b>—</b><span>health</span></div></div>
              <div className="sheet-report-copy"><b>Your audit report</b><span>Live PageSpeed and page checks</span></div>
            </div>
            <div className="sheet-divider" />
            <div className="sheet-stat"><span><Gauge size={15} /> Performance</span><b>—</b></div>
            <div className="sheet-stat"><span><SearchCheck size={15} /> SEO</span><b>—</b></div>
            <div className="sheet-stat"><span><Sparkles size={15} /> Recommendations</span><b className="sheet-ai">AI assisted</b></div>
            <div className="sheet-footer"><span>Scores appear after a live scan</span><ArrowRight size={15} /></div>
          </div>
          <div className="hero-stamp"><span>01</span><div>One clear<br />next step.</div></div>
          <div className="hero-grid-mark" aria-hidden="true" />
        </div>
        <a href="#features" className="scroll-cue"><ArrowDown size={15} /> Explore the platform</a>
      </section>
      <section id="features" className="feature-section section-pad">
        <div className="section-intro"><div className="eyebrow">A CLEARER PICTURE</div><h2>Everything important.<br /><span>One useful report.</span></h2><p>SiteSense combines measured performance data with practical technical checks, so you can move from issue to fix with confidence.</p></div>
        <div className="feature-grid">
          <article className="feature-card"><span className="feature-icon"><Gauge size={19} /></span><div className="feature-index">01</div><h3>Real performance data</h3><p>PageSpeed Insights measures performance, accessibility, best practices, SEO, and Core Web Vitals for mobile or desktop.</p></article>
          <article className="feature-card"><span className="feature-icon"><SearchCheck size={19} /></span><div className="feature-index">02</div><h3>Technical SEO checks</h3><p>Review page metadata, heading structure, image alt text, internal links, crawl files, and social sharing tags.</p></article>
          <article className="feature-card"><span className="feature-icon"><Sparkles size={19} /></span><div className="feature-index">03</div><h3>Recommendations with context</h3><p>Gemini explains confirmed findings, why they matter, and the next actions worth taking first.</p></article>
        </div>
      </section>
      <section id="how-it-works" className="how-section section-pad">
        <div className="how-heading"><div className="eyebrow">HOW IT WORKS</div><h2>From URL to<br />action plan.</h2></div>
        <div className="how-steps">
          <div className="how-step"><span>01</span><div><h3>Enter a public URL</h3><p>Choose a mobile or desktop audit and start your scan.</p></div><Check size={18} /></div>
          <div className="how-step"><span>02</span><div><h3>Measure what matters</h3><p>SiteSense checks the page markup and requests a real Lighthouse report.</p></div><Check size={18} /></div>
          <div className="how-step"><span>03</span><div><h3>Fix issues in order</h3><p>Review clear findings and AI-assisted actions in your report.</p></div><Check size={18} /></div>
        </div>
      </section>
      <footer className="landing-footer"><Link className="brand-lockup" to="/"><span className="brand-mark"><Activity size={18} /></span><span>SiteSense<span className="brand-ai"> AI</span></span></Link><span>Understand Your Website. Improve Your Performance.</span><Link to="/dashboard">Open dashboard <ArrowRight size={14} /></Link></footer>
    </div>
  );
}
