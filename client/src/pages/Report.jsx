import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, Clock3, ExternalLink, Gauge, SearchCheck, Sparkles, TriangleAlert, Zap } from 'lucide-react';
import { getScan, getErrorMessage } from '../lib/api.js';
import { ScoreCard, ScoreRing } from '../components/ScoreCard.jsx';

const priorityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3, critical: 0, high: 1, medium: 2, low: 3 };
const dateText = (date) => date ? new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable';
const priorityClass = (priority = 'Low') => `priority-${String(priority).toLowerCase()}`;

export default function Report() {
  const { id } = useParams();
  const location = useLocation();
  const localScan = id === 'latest' ? location.state?.scan : null;
  const [scan, setScan] = useState(localScan ?? null);
  const [loading, setLoading] = useState(!localScan);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  const loadReport = useCallback(() => {
    if (localScan) { setScan(localScan); setLoading(false); setError(''); return; }
    if (!id || id === 'latest') {
      setError('This session report is unavailable. Run another scan or open a saved report from history.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    getScan(id).then(setScan).catch((requestError) => setError(getErrorMessage(requestError))).finally(() => setLoading(false));
  }, [id, localScan]);

  useEffect(() => { loadReport(); }, [loadReport, reload]);

  if (loading) return <ReportSkeleton />;
  if (error || !scan) return <ReportError message={error || 'The scan report could not be loaded.'} onRetry={() => setReload((value) => value + 1)} />;

  const analysis = scan.geminiAnalysis;
  const issues = scan.issues ?? scan.technicalFindings?.findings ?? [];
  const warnings = scan.serviceWarnings ?? [];
  const geminiWarning = warnings.find((warning) => /gemini/i.test(warning));
  const pageSpeedWarning = warnings.find((warning) => /pagespeed/i.test(warning));
  const pageFacts = scan.technicalFindings?.pageFacts ?? {};
  const pageSpeed = scan.pageSpeedData ?? {};
  const vitals = scan.coreWebVitals ?? pageSpeed.coreWebVitals ?? {};
  const categories = [
    ['Performance', scan.performanceScore, Gauge],
    ['Accessibility', scan.accessibilityScore, CheckCircle2],
    ['Best practices', scan.bestPracticesScore, Activity],
    ['SEO', scan.seoScore, SearchCheck],
  ];

  const categoryRecommendations = analysis ? [
    ...(analysis.seoRecommendations ?? []),
    ...(analysis.technicalSeoRecommendations ?? []),
    ...(analysis.performanceRecommendations ?? []),
    ...(analysis.contentRecommendations ?? []),
    ...(analysis.accessibilityRecommendations ?? []),
  ] : [];
  const analysisRecommendations = [
    ...(analysis?.prioritizedActionPlan ?? []),
    ...categoryRecommendations,
  ];
  const analysisByKey = new Map(analysisRecommendations.map((item) => [`${item.category}:${item.title.toLowerCase()}`, item]));
  const recommendationSource = scan.recommendations?.length
    ? scan.recommendations.map((item) => ({ ...item, ...(analysisByKey.get(`${item.category}:${item.title.toLowerCase()}`) ?? {}) }))
    : categoryRecommendations;
  const recommendations = [...new Map(recommendationSource.map((item) => [`${item.category}:${item.title}`, item])).values()]
    .sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));
  const actionPlan = analysis?.prioritizedActionPlan ?? [];
  const priorityCounts = ['Critical', 'High', 'Medium', 'Low'].map((priority) => ({ priority, count: issues.filter((issue) => issue.priority?.toLowerCase() === priority.toLowerCase()).length }));

  return (
    <div className="page-stack report-page">
      <div className="report-back-row"><Link to="/history" className="back-link"><ArrowLeft size={16} /> Scan history</Link><span className={`status-label ${scan.status === 'completed' ? 'status-complete' : 'status-partial'}`}><i />{scan.status === 'completed' ? 'Complete' : 'Partial report'}</span></div>

      <header className="report-header">
        <div className="report-site-heading"><div className="eyebrow">WEBSITE AUDIT</div><h1>{safeHost(scan.url)}</h1><a href={scan.url} target="_blank" rel="noreferrer" className="report-url">{scan.url} <ExternalLink size={14} /></a></div>
        <div className="report-header-actions"><div className="report-meta"><span><Clock3 size={15} /> {dateText(scan.scannedAt)}</span><span className="capitalize">{scan.device} analysis</span></div><Link to={`/scan?url=${encodeURIComponent(scan.url)}`} className="button button-secondary button-small"><Activity size={15} /> Scan again</Link></div>
      </header>

      {warnings.length > 0 && <div className="notice notice-warning report-warning" role="status"><TriangleAlert size={18} /><div><b>Some analysis services did not return results.</b><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div></div>}
      {scan.persisted === false && <div className="notice report-session-notice"><Activity size={17} /><span>This report is available in this session. Configure PostgreSQL to save it in scan history.</span></div>}

      <section className="report-score-overview" aria-label="Website health scores">
        <div className="panel overall-panel">
          <div className="overall-copy"><div className="eyebrow">OVERALL HEALTH</div><h2>{scan.overallScore == null ? 'Score unavailable' : 'Website health'}</h2><p>{scan.overallScore == null ? 'A combined score needs all four PageSpeed category scores.' : 'Average of the four measured PageSpeed category scores.'}</p><span className="overall-source">{scan.overallScore == null ? 'No combined score' : 'PageSpeed Insights · 4 categories'}</span></div>
          <ScoreRing score={scan.overallScore} label="Health" />
        </div>
        <div className="score-grid report-score-grid">{categories.map(([label, score, Icon]) => <ScoreCard key={label} label={label} score={score} icon={Icon} note="PageSpeed Insights" />)}</div>
      </section>

      <section className="report-two-col">
        <section className="panel cwv-panel">
          <PanelHeading title="Core Web Vitals" subtitle="Field data when available; otherwise Lighthouse lab measurements" icon={Activity} />
          {pageSpeedWarning && <div className="inline-service-state"><TriangleAlert size={16} /><span>{pageSpeedWarning}</span></div>}
          {scan.pageSpeedData ? <>
            <div className="vitals-grid"><Vital label="Largest Contentful Paint" abbreviation="LCP" metric={vitals.lcp} /><Vital label="Cumulative Layout Shift" abbreviation="CLS" metric={vitals.cls} /><Vital label="Interaction to Next Paint" abbreviation="INP" metric={vitals.inp} /></div>
            <div className="performance-facts"><Fact label="First contentful paint" value={vitals.fcp} /><Fact label="Total blocking time" value={vitals.tbt} /><Fact label="Data source" value={vitals.fieldDataAvailable ? 'Real-user data available' : 'Lighthouse lab data'} /></div>
          </> : <div className="service-empty"><Activity size={20} /><div><b>PageSpeed measurements unavailable</b><span>{pageSpeedWarning || 'No performance metrics were returned for this scan.'}</span></div></div>}
        </section>

        <section className="panel summary-panel">
          <PanelHeading title="AI assessment" subtitle="Recommendations tied to measured findings" icon={Sparkles} />
          {analysis ? <>
            <p className="ai-summary">{analysis.websiteSummary}</p><p className="ai-assessment">{analysis.overallAssessment}</p>
            {analysis.topProblems?.length > 0 ? <div className="top-problems"><div className="section-label-row"><h3>Most important problems</h3><span>{analysis.topProblems.length} evidence-linked</span></div>{analysis.topProblems.map((problem, index) => <TopProblem key={problem.evidenceRef ?? problem.title ?? index} problem={problem} index={index} />)}</div> : <div className="quiet-empty">No high-priority issues were returned by the available audit data.</div>}
          </> : <div className="service-empty"><Sparkles size={20} /><div><b>AI recommendations unavailable</b><span>{geminiWarning || 'Configure GEMINI_API_KEY and GEMINI_MODEL, then run another scan.'}</span></div></div>}
        </section>
      </section>

      <section className="panel findings-panel">
        <PanelHeading title="Technical findings" subtitle="Detected in page HTML and public site resources" trailing={<span className="finding-count">{issues.length} {issues.length === 1 ? 'finding' : 'findings'}</span>} />
        <div className="facts-strip"><Fact label="H1 headings" value={formatValue(pageFacts.h1Count)} /><Fact label="Images missing alt" value={formatValue(pageFacts.imagesMissingAlt)} /><Fact label="Internal links checked" value={formatValue(pageFacts.internalLinksChecked)} /><Fact label="Sitemap" value={pageFacts.sitemapAvailable == null ? 'Not checked' : pageFacts.sitemapAvailable ? 'Available' : 'Not found'} /></div>
        {issues.length ? <>
          <div className="issue-priority-summary">{priorityCounts.filter(({ count }) => count > 0).map(({ priority, count }) => <span key={priority} className={`priority-count ${priorityClass(priority)}`}><i />{count} {priority}</span>)}</div>
          <div className="finding-list">{issues.map((item, index) => <IssueDisclosure key={item.key ?? item.id ?? index} item={item} initiallyOpen={item.priority?.toLowerCase() === 'critical'} />)}</div>
        </> : <div className="no-findings"><CheckCircle2 size={21} /><div><b>No technical issues detected</b><span>The HTML checks completed without findings for this page.</span></div></div>}
        <details className="extracted-data"><summary><span>Inspect extracted page data</span><small>{pageFacts.headings?.length ?? 0} headings · {pageFacts.images?.length ?? 0} images · {pageFacts.links?.length ?? 0} links</small></summary>
          <div className="extracted-grid">
            <ExtractedList title="Headings" items={pageFacts.headings?.map((item) => ({ label: `H${item.level}`, text: item.text }))} empty="No readable headings found." />
            <ExtractedList title="Images" items={pageFacts.images?.slice(0, 30).map((item) => ({ label: item.hasAlt ? 'Alt text' : 'Missing alt', text: item.alt || item.src || 'Image source unavailable' }))} empty="No image elements found." />
            <ExtractedList title="Links" items={pageFacts.links?.slice(0, 30).map((item) => ({ label: item.isInternal ? 'Internal' : 'External', text: item.text || item.href }))} empty="No links found." />
            <div className="extracted-column"><h3>Page metadata</h3><Fact label="Title" value={pageFacts.title || 'Missing'} /><Fact label="Description" value={pageFacts.description || 'Missing'} /><Fact label="Viewport" value={pageFacts.viewportContent || 'Missing'} /><Fact label="Canonical URL" value={pageFacts.canonicalResolved || pageFacts.canonical || 'Missing'} /><Fact label="Open Graph" value={pageFacts.openGraphMissing?.length ? `Missing ${pageFacts.openGraphMissing.join(', ')}` : 'Core tags present'} /></div>
          </div>
        </details>
      </section>

      <section className="panel recommendations-panel">
        <PanelHeading title="AI recommendations" subtitle="Fixes grounded in your scan results" icon={Sparkles} />
        {recommendations.length > 0 ? <div className="recommendation-grid">{recommendations.map((item, index) => <RecommendationCard key={`${item.category}-${item.title}-${index}`} item={item} />)}</div> : <div className="service-empty"><Sparkles size={20} /><div><b>No recommendations available</b><span>{geminiWarning || 'Gemini did not return validated advice for this scan. Technical findings remain available above.'}</span></div></div>}
      </section>

      <section className="panel action-plan-panel">
        <PanelHeading title="Recommended action plan" subtitle="A prioritized sequence based on the findings" icon={Zap} trailing={<span className="finding-count">{actionPlan.length} {actionPlan.length === 1 ? 'action' : 'actions'}</span>} />
        {actionPlan.length > 0 ? <ol className="action-plan-list">{actionPlan.map((item, index) => <li key={`${item.title}-${index}`}><span className="action-plan-number">{String(index + 1).padStart(2, '0')}</span><div className="action-plan-content"><div className="action-plan-heading"><b>{item.title}</b><span className={`priority-tag ${priorityClass(item.priority)}`}>{item.priority}</span><span className="recommendation-category">{item.category}</span></div><p>{item.action}</p>{item.evidence?.length > 0 && <small>Based on: {item.evidence.map((source) => source.title).join(' · ')}</small>}</div></li>)}</ol> : <div className="quiet-empty">A recommended sequence will appear when Gemini returns evidence-linked actions.</div>}
      </section>

      {(pageSpeed.opportunities?.length > 0 || pageSpeed.diagnostics?.length > 0) && <section className="panel opportunities-panel"><PanelHeading title="PageSpeed opportunities" subtitle="Optimization opportunities and diagnostics returned by Lighthouse" icon={Gauge} /><div className="opportunity-list">{[...(pageSpeed.opportunities ?? []), ...(pageSpeed.diagnostics ?? [])].map((item, index) => <div className="opportunity-row" key={`${item.id ?? item.title}-${index}`}><span className="opportunity-dot" /><div><b>{item.title}</b><span>{stripMarkup(item.description)}</span></div><small>{item.displayValue || ''}</small></div>)}</div></section>}

      <div className="report-end-actions"><Link to="/history" className="back-link"><ArrowLeft size={15} /> Back to history</Link><span><Activity size={15} /> Measurements provided by Google PageSpeed Insights</span></div>
    </div>
  );
}

function PanelHeading({ title, subtitle, icon: Icon, trailing }) {
  return <div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><div className="panel-heading-right">{trailing}{Icon && <span className="quick-icon"><Icon size={18} /></span>}</div></div>;
}

function TopProblem({ problem, index }) {
  if (typeof problem === 'string') return <div className="top-problem"><span className="top-problem-index">{String(index + 1).padStart(2, '0')}</span><p>{problem}</p></div>;
  return <div className="top-problem"><span className="top-problem-index">{String(index + 1).padStart(2, '0')}</span><div className="top-problem-body"><div className="top-problem-heading"><b>{problem.title}</b>{problem.priority && <span className={`priority-tag ${priorityClass(problem.priority)}`}>{problem.priority}</span>}</div><p>{problem.whyItMatters}</p>{problem.description && <small>Evidence: {problem.description}</small>}</div></div>;
}

function Vital({ label, abbreviation, metric }) {
  const rating = metric?.rating;
  return <div className={`vital-card ${rating ? `vital-${rating.replaceAll(' ', '-')}` : ''}`}>
    <div className="vital-top"><span>{abbreviation}</span><i /></div>
    <div className="vital-value">{metric?.displayValue || '—'}</div>
    <div className="vital-label">{label}</div>
    <div className="vital-status">{rating || 'Not reported'}</div>
    {metric?.source && <div className="vital-source">{metric.source}</div>}
  </div>;
}

function Fact({ label, value }) {
  return <div className="fact-cell"><span>{label}</span><b>{value ?? '—'}</b></div>;
}

function IssueDisclosure({ item, initiallyOpen }) {
  return <details className="finding-item" open={initiallyOpen}>
    <summary><span className={`priority-mark ${priorityClass(item.priority)}`}><CircleAlert size={17} /></span><span className="finding-summary-copy"><b>{item.title}</b><small>{item.category}</small></span><span className={`priority-tag ${priorityClass(item.priority)}`}>{item.priority}</span><span className="finding-chevron"><ArrowRight size={15} /></span></summary>
    <div className="finding-content"><p>{item.description}</p>{item.howToFix && <div className="finding-fix"><b>How to fix</b><span>{item.howToFix}</span></div>}{item.exampleCode && <pre className="code-sample"><code>{item.exampleCode}</code></pre>}</div>
  </details>;
}

function ExtractedList({ title, items = [], empty }) {
  return <div className="extracted-column"><h3>{title}</h3>{items?.length ? items.map((item, index) => <div className="extracted-row" key={`${item.label}-${index}`}><b>{item.label}</b><span>{item.text}</span></div>) : <small>{empty}</small>}</div>;
}

function RecommendationCard({ item }) {
  return <article className="recommendation-card"><div className="recommendation-meta"><span className="recommendation-category">{item.category}</span><span className={`priority-tag ${priorityClass(item.priority)}`}>{item.priority}</span></div><h3>{item.title}</h3>{item.explanation && <p>{item.explanation}</p>}{item.whyItMatters && <div className="recommendation-why"><b>Why it matters</b><span>{item.whyItMatters}</span></div>}<div className="recommendation-action"><b>How to fix</b><span>{item.action}</span></div>{item.evidence?.length > 0 && <div className="recommendation-evidence"><b>Detected evidence</b>{item.evidence.map((source) => <div key={source.ref}><span>{source.title}</span><small>{source.detail}</small></div>)}</div>}{item.exampleCode && <pre className="code-sample"><code>{item.exampleCode}</code></pre>}</article>;
}

function ReportSkeleton() {
  return <div className="report-skeleton page-stack" role="status" aria-label="Loading report">
    <div className="skeleton-line skeleton-short" />
    <div className="skeleton-heading"><span /><i /><i /></div>
    <div className="report-score-overview"><div className="panel skeleton-panel" /><div className="score-grid report-score-grid">{Array.from({ length: 4 }, (_, index) => <div className="panel skeleton-card" key={index} />)}</div></div>
    <div className="report-two-col"><div className="panel skeleton-panel" /><div className="panel skeleton-panel" /></div>
    <div className="panel skeleton-panel skeleton-large" />
    <div className="loading-caption">Loading measured audit findings and recommendations…</div>
  </div>;
}

function ReportError({ message, onRetry }) {
  return <div className="report-state"><div className="error-state-icon"><TriangleAlert size={24} /></div><h2>Report unavailable</h2><p>{message}</p><div className="report-error-actions"><button className="button button-secondary" onClick={onRetry}>Try again</button><Link to="/scan" className="button button-primary">Start a new scan <ArrowRight size={16} /></Link></div></div>;
}

function formatValue(value) { return Number.isFinite(value) ? value : '—'; }
function safeHost(url) { try { return new URL(url).hostname; } catch { return url; } }
function stripMarkup(text = '') { return text.replace(/<[^>]*>/g, '').replace(/\[Learn more\]\([^)]*\)/g, '').trim(); }
