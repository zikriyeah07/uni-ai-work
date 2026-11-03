import { AppError } from '../utils/errors.js';

function auditValue(audits, key) {
  const audit = audits?.[key];
  if (!audit) return null;
  return {
    id: key,
    title: audit.title,
    description: audit.description,
    displayValue: audit.displayValue ?? null,
    score: audit.score,
    numericValue: audit.numericValue ?? null,
    scoreDisplayMode: audit.scoreDisplayMode ?? null,
    details: audit.details?.items?.slice(0, 5).map((item) => ({
      url: item.url,
      totalBytes: item.totalBytes,
      wastedBytes: item.wastedBytes,
      label: item.label,
      node: item.node?.snippet,
    })) ?? [],
  };
}

function fieldMetric(metrics, key, kind, source) {
  const metric = metrics?.[key];
  if (!metric || !Number.isFinite(metric.percentile)) return null;
  const rawValue = metric.percentile;
  const value = kind === 'cls' ? rawValue / 1000 : rawValue;
  const rating = ({ FAST: 'good', AVERAGE: 'needs improvement', SLOW: 'poor' })[metric.category] ?? null;
  const displayValue = kind === 'lcp' ? `${(value / 1000).toFixed(1)} s`
    : kind === 'inp' ? `${Math.round(value)} ms`
      : value.toFixed(3);
  return { value, displayValue, rating, source, category: metric.category ?? null };
}

function labMetric(audit, kind) {
  if (!audit || !Number.isFinite(audit.numericValue)) return null;
  const value = audit.numericValue;
  let rating = null;
  if (kind === 'lcp') rating = value <= 2500 ? 'good' : value <= 4000 ? 'needs improvement' : 'poor';
  else if (kind === 'cls') rating = value <= 0.1 ? 'good' : value <= 0.25 ? 'needs improvement' : 'poor';
  else if (kind === 'inp') rating = value <= 200 ? 'good' : value <= 500 ? 'needs improvement' : 'poor';
  return { value, displayValue: audit.displayValue ?? null, rating, source: 'Lighthouse lab', category: null };
}

export async function runPageSpeed(url, device = 'mobile') {
  const endpoint = new URL('https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed');
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('strategy', device === 'desktop' ? 'desktop' : 'mobile');
  for (const category of ['performance', 'accessibility', 'best-practices', 'seo']) endpoint.searchParams.append('category', category);
  if (process.env.PAGESPEED_API_KEY) endpoint.searchParams.set('key', process.env.PAGESPEED_API_KEY);

  let response;
  try {
    response = await fetch(endpoint, { signal: AbortSignal.timeout(65000) });
  } catch (error) {
    throw new AppError(error.name === 'TimeoutError' ? 'PageSpeed analysis timed out. Try again in a moment.' : 'Google PageSpeed could not be reached.', 502, 'PAGESPEED_UNAVAILABLE');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMessage = data?.error?.message;
    if (response.status === 429) throw new AppError('Google PageSpeed rate limit reached. Wait a minute and try again.', 429, 'PAGESPEED_RATE_LIMIT');
    throw new AppError(apiMessage || `Google PageSpeed returned HTTP ${response.status}.`, 502, 'PAGESPEED_ERROR');
  }
  const lighthouse = data.lighthouseResult;
  if (!lighthouse?.categories) throw new AppError('Google PageSpeed returned an incomplete report.', 502, 'PAGESPEED_INVALID_RESULT');
  const categories = lighthouse.categories;
  const score = (key) => Number.isFinite(categories[key]?.score) ? Math.round(categories[key].score * 100) : null;
  const audits = lighthouse.audits ?? {};
  const pageField = data.loadingExperience?.metrics ?? {};
  const originField = data.originLoadingExperience?.metrics ?? {};
  const field = (key, kind) => fieldMetric(pageField, key, kind, 'URL field data')
    ?? fieldMetric(originField, key, kind, 'Origin field data');
  const lcpAudit = auditValue(audits, 'largest-contentful-paint');
  const clsAudit = auditValue(audits, 'cumulative-layout-shift');
  const inpAudit = auditValue(audits, 'interaction-to-next-paint') ?? auditValue(audits, 'experimental-interaction-to-next-paint');
  const lcp = field('LARGEST_CONTENTFUL_PAINT_MS', 'lcp') ?? labMetric(lcpAudit, 'lcp');
  const cls = field('CUMULATIVE_LAYOUT_SHIFT_SCORE', 'cls') ?? labMetric(clsAudit, 'cls');
  const inp = field('INTERACTION_TO_NEXT_PAINT', 'inp') ?? labMetric(inpAudit, 'inp');
  const coreWebVitals = {
    lcp,
    cls,
    inp,
    fcp: auditValue(audits, 'first-contentful-paint')?.displayValue ?? null,
    tbt: auditValue(audits, 'total-blocking-time')?.displayValue ?? null,
    fieldDataAvailable: Object.keys(pageField).length > 0 || Object.keys(originField).length > 0,
    fieldDataCategory: data.loadingExperience?.overall_category ?? null,
    originFieldDataCategory: data.originLoadingExperience?.overall_category ?? null,
  };
  const opportunities = Object.values(audits)
    .filter((item) => item.details?.type === 'opportunity' && item.score !== null && item.score < 1)
    .sort((a, b) => (b.details?.overallSavingsMs ?? 0) - (a.details?.overallSavingsMs ?? 0))
    .slice(0, 8)
    .map((item) => ({ id: item.id, title: item.title, description: item.description, displayValue: item.displayValue ?? null, savingsMs: item.details?.overallSavingsMs ?? null }));
  const diagnostics = Object.values(audits)
    .filter((item) => item.details?.type === 'table' && item.score !== null && item.score < 1 && item.id !== 'screenshot-thumbnails')
    .slice(0, 8)
    .map((item) => ({ id: item.id, title: item.title, description: item.description, displayValue: item.displayValue ?? null }));

  return {
    performanceScore: score('performance'),
    accessibilityScore: score('accessibility'),
    bestPracticesScore: score('best-practices'),
    seoScore: score('seo'),
    coreWebVitals,
    opportunities,
    diagnostics,
    analyzedAt: data.analysisUTCTimestamp ?? new Date().toISOString(),
    finalUrl: data.id ?? url,
  };
}
