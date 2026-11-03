import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, ArrowUpRight, Gauge, SearchCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getScans, getErrorMessage } from '../lib/api.js';
import { ScoreCard } from '../components/ScoreCard.jsx';
import ScanForm from '../components/ScanForm.jsx';

const dateLabel = (date) => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const dateTime = (date) => new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const host = (url) => { try { return new URL(url).hostname; } catch { return url; } };

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getScans().then((result) => { if (active) setData(result); })
      .catch((requestError) => { if (active) setError(getErrorMessage(requestError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  const scans = data?.scans ?? [];
  const average = (key) => {
    const values = scans.map((scan) => scan[key]).filter(Number.isFinite);
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  };
  const chartData = useMemo(() => [...scans].slice(0, 12).reverse()
    .filter((item) => Number.isFinite(item.performanceScore))
    .map((item) => ({ date: dateLabel(item.scannedAt), score: item.performanceScore, site: host(item.url), exactDate: dateTime(item.scannedAt) })), [scans]);

  return (
    <div className="page-stack dashboard-page">
      <div className="page-heading-row">
        <div><div className="eyebrow">OVERVIEW</div><h1>Your website health</h1><p>Recent audit results and the measures that need attention.</p></div>
        <Link to="/history" className="text-link">View scan history <ArrowRight size={16} /></Link>
      </div>

      {error && <div className="notice notice-error dashboard-error" role="alert"><TriangleAlert size={18} /><span>{error}</span><button className="button button-secondary button-small" onClick={() => setReload((value) => value + 1)}>Try again</button></div>}
      {data && !data.storageConfigured && <div className="notice"><Activity size={17} /><span>Scan history is not saved yet. Add PostgreSQL <code>DATABASE_URL</code> to keep reports between sessions.</span></div>}

      <section className="score-grid overview-scores" aria-label="Scan statistics">
        {loading && !data ? <MetricSkeletons /> : <>
          <ScoreCard label="Total scans" score={data ? (data.totalScans ?? scans.length) : null} unit="" metric="count" note={data ? (data.storageConfigured ? 'Saved reports' : 'No saved history') : 'Unable to load'} icon={Activity} />
          <ScoreCard label="Average performance" score={average('performanceScore')} note="Across loaded reports" icon={Gauge} />
          <ScoreCard label="Average SEO" score={average('seoScore')} note="Across loaded reports" icon={SearchCheck} />
          <ScoreCard label="Average accessibility" score={average('accessibilityScore')} note="Across loaded reports" icon={Sparkles} />
        </>}
      </section>

      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="panel-heading"><div><h2>Performance trend</h2><p>PageSpeed performance across your latest saved scans</p></div><span className="chart-legend"><i /> Performance</span></div>
          {loading && !data ? <div className="chart-skeleton" aria-label="Loading performance trend" /> : error && !data ? <div className="empty-chart"><div className="error-state-icon"><TriangleAlert size={20} /></div><b>Performance data unavailable</b><span>Saved scans could not be loaded.</span><button className="text-link" onClick={() => setReload((value) => value + 1)}>Try again <ArrowRight size={15} /></button></div> : chartData.length > 0 ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 12, right: 16, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#e8ebf0" vertical={false} />
            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#6c7788', fontSize: 12 }} dy={10} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} axisLine={false} tickLine={false} tick={{ fill: '#6c7788', fontSize: 11 }} />
            <Tooltip cursor={{ stroke: '#aebde1', strokeDasharray: '4 4' }} contentStyle={{ border: '1px solid #dfe3e9', borderRadius: 8, boxShadow: '0 10px 28px rgba(17,29,51,.1)' }} formatter={(value) => [`${value}/100`, 'Performance']} labelFormatter={(label, payload) => payload?.[0]?.payload?.exactDate || label} />
            <Line type="monotone" dataKey="score" stroke="#002fa7" strokeWidth={3} dot={{ r: 4, fill: '#fff', stroke: '#002fa7', strokeWidth: 2 }} activeDot={{ r: 6, fill: '#002fa7', stroke: '#fff', strokeWidth: 2 }} />
          </LineChart></ResponsiveContainer></div> : <div className="empty-chart"><div className="empty-chart-icon"><Activity size={21} /></div><b>{scans.length ? 'No performance scores recorded' : 'No scans yet'}</b><span>{scans.length ? 'Your reports do not include a PageSpeed performance score.' : 'Run your first audit to see performance data here.'}</span>{scans.length === 0 && <Link to="/scan" className="text-link">Start a scan <ArrowRight size={15} /></Link>}</div>}
        </section>

        <section className="panel quick-panel">
          <div className="panel-heading"><div><h2>Quick scan</h2><p>Analyze a public website</p></div><span className="quick-icon"><Gauge size={18} /></span></div>
          <ScanForm compact onComplete={(scan) => navigate(scan.id ? `/reports/${scan.id}` : '/reports/latest', { state: { scan } })} />
          <div className="quick-panel-foot"><span className="shield-small"><Activity size={14} /></span> Public HTTP and HTTPS pages</div>
        </section>
      </div>

      <section className="panel recent-panel">
        <div className="panel-heading"><div><h2>Recent scans</h2><p>Latest reports saved to your workspace</p></div><Link to="/history" className="text-link">All scans <ArrowRight size={15} /></Link></div>
        {loading && !data ? <RecentSkeleton /> : error && !data ? <div className="empty-table"><div className="error-state-icon"><TriangleAlert size={20} /></div><b>Saved scans unavailable</b><span>Try again to retrieve your recent reports.</span><button className="button button-secondary button-small" onClick={() => setReload((value) => value + 1)}>Try again</button></div> : scans.length > 0 ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Website</th><th>Scanned</th><th>Device</th><th>Performance</th><th>SEO</th><th>Report</th></tr></thead><tbody>
          {scans.slice(0, 6).map((scan) => <tr key={scan.id}><td><span className="site-cell"><span className="site-favicon">{host(scan.url).charAt(0).toUpperCase()}</span><span><b>{host(scan.url)}</b><small>{scan.url}</small></span></span></td><td>{dateTime(scan.scannedAt)}</td><td className="capitalize">{scan.device}</td><td><ScorePill score={scan.performanceScore} /></td><td><ScorePill score={scan.seoScore} /></td><td><Link to={`/reports/${scan.id}`} className="icon-link" aria-label={`View report for ${host(scan.url)}`}><ArrowUpRight size={17} /></Link></td></tr>)}
        </tbody></table></div> : <div className="empty-table"><div className="empty-chart-icon"><Activity size={21} /></div><b>No saved scans</b><span>Run an audit and its report will appear here when PostgreSQL is configured.</span><Link to="/scan" className="button button-primary button-small">Scan a website</Link></div>}
      </section>
    </div>
  );
}

function MetricSkeletons() {
  return <>{Array.from({ length: 4 }, (_, index) => <div className="metric-skeleton" key={index}><span /><b /><i /></div>)}</>;
}

function RecentSkeleton() {
  return <div className="recent-skeleton" aria-label="Loading recent scans">{Array.from({ length: 4 }, (_, index) => <div key={index}><i /><span /><span /><span /></div>)}</div>;
}

function ScorePill({ score }) {
  if (score == null) return <span className="score-pill unavailable">—</span>;
  return <span className={`score-pill ${score >= 90 ? 'good' : score >= 50 ? 'warn' : 'poor'}`}>{score}</span>;
}
