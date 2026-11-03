import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Activity, Check, Clock3, ShieldCheck, Sparkles, Zap, CircleAlert } from 'lucide-react';
import ScanForm from '../components/ScanForm.jsx';

export default function Scanner() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [scanning, setScanning] = useState(false);
  const [progressEvents, setProgressEvents] = useState([]);
  const progressSteps = [
    ['html', 'Fetch and inspect page HTML'],
    ['links', 'Check internal links'],
    ['site-files', 'Check robots.txt and sitemap'],
    ['pagespeed', 'Get PageSpeed and Core Web Vitals'],
    ['gemini', 'Generate recommendations'],
    ['persistence', 'Save the report to PostgreSQL'],
  ];
  const currentProgress = progressEvents.at(-1);
  const stageEvents = Object.fromEntries(progressSteps.map(([stage]) => [stage, progressEvents.filter((event) => event.stage === stage).at(-1)]));
  return (
    <div className="page-stack scanner-page">
      <div className="page-heading-row"><div><div className="eyebrow">LIVE WEBSITE ANALYSIS</div><h1>Website scanner</h1><p>Get measured results and a clear list of next steps.</p></div></div>
      <div className="scanner-layout">
        <section className="panel scanner-form-panel">
          <div className="scanner-form-head"><span className="scanner-symbol"><Zap size={20} /></span><div><h2>Start a new audit</h2><p>Enter the public page you want SiteSense to review.</p></div></div>
          <ScanForm initialUrl={params.get('url') || ''} onLoadingChange={setScanning} onProgress={(event) => setProgressEvents((events) => event.stage === 'reset' ? [] : [...events, event])} onComplete={(scan) => navigate(scan.id ? `/reports/${scan.id}` : '/reports/latest', { state: { scan } })} />
          {scanning && <div className="scan-progress" role="status" aria-live="polite">
            <div className="scan-progress-top"><span className="progress-spinner"><Activity size={17} /></span><div><b>{currentProgress?.message || 'Starting the website scan.'}</b><span>Results stream from the scanner. Optional service failures do not discard the HTML audit.</span></div></div>
            <div className="progress-sequence">Scan steps</div>
            {progressSteps.map(([stage, label]) => {
              const event = stageEvents[stage];
              const status = event?.status ?? 'queued';
              const Icon = status === 'unavailable' ? CircleAlert : status === 'complete' ? Check : status === 'running' ? Activity : Clock3;
              return <div className={`progress-step progress-${status}`} key={stage}><Icon size={14} /><span>{label}</span><small>{status === 'queued' ? 'Waiting' : status === 'complete' ? 'Complete' : status === 'unavailable' ? 'Unavailable' : 'Running'}</small></div>;
            })}
          </div>}
          <div className="scanner-privacy"><ShieldCheck size={16} /><span>Only public HTTP and HTTPS pages are accepted. Local and private network addresses are blocked.</span></div>
        </section>
        <aside className="panel scanner-aside">
          <div className="aside-title"><span className="aside-icon"><Activity size={16} /></span><h3>What gets checked</h3></div>
          <div className="check-list"><span><Check size={14} /> Title, description, headings</span><span><Check size={14} /> Images and internal links</span><span><Check size={14} /> Canonical, viewport, Open Graph</span><span><Check size={14} /> robots.txt and XML sitemap</span><span><Check size={14} /> Lighthouse scores and CWV</span><span><Check size={14} /> Evidence-based AI actions</span></div>
          <div className="aside-divider" /><p className="aside-disclaimer">PageSpeed and Gemini are external services. Missing keys, quotas, or network issues are shown in your report.</p>
        </aside>
      </div>
    </div>
  );
}
