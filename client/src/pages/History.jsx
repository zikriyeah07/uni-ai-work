import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowUpRight, Search, TriangleAlert } from 'lucide-react';
import { getScans, getErrorMessage } from '../lib/api.js';

function ScorePill({ score }) {
  if (score == null) return <span className="score-pill unavailable">—</span>;
  return <span className={`score-pill ${score >= 90 ? 'good' : score >= 50 ? 'warn' : 'poor'}`}>{score}</span>;
}

export default function History() {
  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getScans().then((result) => { if (active) setData(result); })
      .catch((e) => { if (active) setError(getErrorMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  const scans = useMemo(() => (data?.scans ?? []).filter((scan) => scan.url.toLowerCase().includes(query.toLowerCase())), [data, query]);

  if (error && !data) return <div className="page-stack"><div className="page-heading-row"><div><div className="eyebrow">THIS BROWSER SESSION</div><h1>Recent scans</h1><p>Review reports created in this browser session.</p></div></div><div className="state-card error-state"><span><TriangleAlert size={20} /></span><div><b>Session reports could not load</b><p>{error}</p><button className="button button-secondary button-small" onClick={() => setReload((value) => value + 1)}>Try again</button></div></div></div>;
  return (
    <div className="page-stack">
      <div className="page-heading-row"><div><div className="eyebrow">THIS BROWSER SESSION</div><h1>Recent scans</h1><p>Review reports created in this browser session.</p></div><div className="history-count">{data?.scans?.length ?? '—'} <span>reports</span></div></div>
      {error && <div className="notice notice-error" role="alert"><TriangleAlert size={17} /> {error}<button className="inline-retry" onClick={() => setReload((value) => value + 1)}>Retry</button></div>}
      <section className="panel history-panel">
        <div className="history-toolbar"><div><h2>Session reports</h2><p>Most recent first · clears when this browser session ends</p></div><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by website" /></label></div>
        {loading && !data ? <HistorySkeleton /> : scans.length ? <div className="table-wrap"><table className="data-table history-table"><thead><tr><th>Website</th><th>Scan date</th><th>Device</th><th>Status</th><th>Performance</th><th>SEO</th><th /></tr></thead><tbody>
          {scans.map((scan) => <tr key={scan.id}><td><span className="site-cell"><span className="site-favicon">{safeHost(scan.url).charAt(0).toUpperCase()}</span><span><b>{safeHost(scan.url)}</b><small>{scan.url}</small></span></span></td><td>{new Date(scan.scannedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td className="capitalize">{scan.device}</td><td><span className={`status-label ${scan.status === 'completed' ? 'status-complete' : 'status-partial'}`}><i />{scan.status === 'completed' ? 'Complete' : 'Partial'}</span></td><td><ScorePill score={scan.performanceScore} /></td><td><ScorePill score={scan.seoScore} /></td><td><Link to={`/reports/${scan.id}`} className="table-action">Open report <ArrowUpRight size={15} /></Link></td></tr>)}
        </tbody></table></div> : data ? <div className="empty-table"><div className="empty-chart-icon"><Activity size={20} /></div><b>{query ? 'No matching scans' : 'No scans in this session'}</b><span>{query ? 'Try a different website name.' : 'Completed audits appear here until this browser session ends.'}</span><Link to="/scan" className="button button-primary button-small">Scan a website</Link></div> : null}
      </section>
    </div>
  );
}

function HistorySkeleton() {
  return <div className="recent-skeleton history-skeleton" aria-label="Loading session reports">{Array.from({ length: 6 }, (_, index) => <div key={index}><i /><span /><span /><span /></div>)}</div>;
}

function safeHost(url) { try { return new URL(url).hostname; } catch { return url; } }
