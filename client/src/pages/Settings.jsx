import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, CircleHelp, Database, Gauge, Sparkles, TriangleAlert } from 'lucide-react';
import { getHealth, getErrorMessage } from '../lib/api.js';

function ServiceRow({ icon: Icon, title, description, configured, detail }) {
  return <div className="service-row"><span className="service-icon"><Icon size={17} /></span><div className="service-copy"><b>{title}</b><span>{description}</span></div><div className={`service-state ${configured ? 'connected' : 'not-connected'}`}><i />{configured ? 'Configured' : 'Not configured'}</div>{detail && <small className="service-detail">{detail}</small>}</div>;
}

export default function Settings() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getHealth().then((result) => { if (active) setHealth(result); })
      .catch((e) => { if (active) setError(getErrorMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  return (
    <div className="page-stack">
      <div className="page-heading-row"><div><div className="eyebrow">APPLICATION STATUS</div><h1>Settings</h1><p>Check service configuration for this SiteSense instance.</p></div></div>
      {error && <div className="notice notice-error" role="alert"><TriangleAlert size={17} /> <span>{error}</span><button className="inline-retry" onClick={() => setReload((value) => value + 1)}>Retry</button></div>}
      <section className="panel settings-panel">
        <div className="settings-panel-head"><div className="settings-head-icon"><Activity size={17} /></div><div><h2>Connected services</h2><p>Configuration is read from server environment variables. Values are never shown here.</p></div></div>
        {loading && !health ? <div className="settings-skeleton">{Array.from({ length: 4 }, (_, index) => <div className="service-skeleton" key={index}><i /><span /><b /></div>)}</div> : error && !health ? <div className="settings-load-error"><b>Service status unavailable</b><span>Configuration could not be read from the API.</span><button className="button button-secondary button-small" onClick={() => setReload((value) => value + 1)}>Try again</button></div> : <div className="service-list">
          <ServiceRow icon={Database} title="PostgreSQL database" description="Stores scan history, issues, and recommendations." configured={health?.services?.database} detail="DATABASE_URL" />
          <ServiceRow icon={Gauge} title="PageSpeed Insights" description="Runs Lighthouse analysis and provides measured website scores." configured={health?.services?.pageSpeedApiKey} detail={health?.services?.pageSpeedApiKey ? 'API key configured' : 'Key is optional at low volume; Google quota may be limited'} />
          <ServiceRow icon={Sparkles} title="Gemini" description="Fallback AI provider for CV reviews, roadmaps, and SiteSense recommendations." configured={health?.services?.gemini} detail={health?.services?.gemini ? `Model: ${health.services.geminiModel}` : 'GEMINI_API_KEY'} />
          <ServiceRow icon={Sparkles} title="OpenRouter" description="Routes AI tasks through free models and returns structured recommendations." configured={health?.services?.openRouter} detail={health?.services?.openRouter ? `Model: ${health.services.openRouterModel}` : 'OPENROUTER_API_KEY'} />
        </div>}
        <div className="settings-help"><CircleHelp size={17} /><p>AI tries providers in this order: <code>{health?.services?.aiProviderOrder?.join(' → ') || 'openrouter → gemini'}</code>. At least one provider key is needed; both keys enable automatic failover. Set <code>AI_PROVIDER_ORDER</code> and provider keys in the server environment, then restart or redeploy. CV files may be sent to the fallback provider if the first provider fails. See the README for setup steps.</p></div>
      </section>
      <div className="settings-note"><CheckCircle2 size={16} /> API secrets remain server-side and are not returned to the browser.</div>
    </div>
  );
}
