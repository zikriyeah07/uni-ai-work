function calculatedOverall(pageSpeed) {
  if (!pageSpeed) return null;
  const scores = [pageSpeed.performanceScore, pageSpeed.accessibilityScore, pageSpeed.bestPracticesScore, pageSpeed.seoScore].filter(Number.isFinite);
  return scores.length === 4 ? Math.round(scores.reduce((sum, value) => sum + value, 0) / 4) : null;
}

function readableServiceError(error, serviceName) {
  let detail = typeof error?.message === 'string' ? error.message : '';
  if (process.env.OPENROUTER_API_KEY) detail = detail.replaceAll(process.env.OPENROUTER_API_KEY, '[redacted]');
  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 320);
  return detail ? `${serviceName} failed: ${detail}` : `${serviceName} failed without returning an error message.`;
}

export async function executeScan({ url, device, onProgress = () => {} }, dependencies = {}) {
  const auditWebsite = dependencies.auditWebsite ?? (await import('./site-audit.service.js')).auditWebsite;
  const runPageSpeed = dependencies.runPageSpeed ?? (await import('./pagespeed.service.js')).runPageSpeed;
  const generateOpenRouterAnalysis = dependencies.generateOpenRouterAnalysis ?? (await import('./openrouter.service.js')).generateOpenRouterAnalysis;
  const getPrisma = dependencies.getPrisma ?? (await import('../db/prisma.js')).getPrisma;
  onProgress({ stage: 'html', status: 'running', message: 'Validating the public URL and starting the HTML audit.' });
  const warnings = [];
  let pageSpeed = null;
  let pageSpeedTask;
  const startPageSpeed = (targetUrl) => {
    if (pageSpeedTask) return;
    onProgress({ stage: 'pagespeed', status: 'running', message: `Requesting Google PageSpeed Insights for ${device}.` });
    pageSpeedTask = Promise.resolve().then(() => runPageSpeed(targetUrl, device)).then(
      (result) => ({ result }),
      (error) => ({ error }),
    );
  };
  const audit = await auditWebsite(url, { onProgress, onPageResolved: startPageSpeed });
  if (!pageSpeedTask) startPageSpeed(audit.finalUrl);
  const pageSpeedOutcome = await pageSpeedTask;
  try {
    if (pageSpeedOutcome.error) throw pageSpeedOutcome.error;
    pageSpeed = pageSpeedOutcome.result;
    onProgress({ stage: 'pagespeed', status: 'complete', message: 'PageSpeed scores and available web vitals were received.' });
  } catch (error) {
    const message = error.message || 'Google PageSpeed analysis failed.';
    warnings.push(message);
    onProgress({ stage: 'pagespeed', status: 'unavailable', message: `${message} Continuing with the HTML audit.` });
  }

  onProgress({ stage: 'openrouter', status: 'running', message: 'Generating recommendations from confirmed findings.' });
  let aiAnalysis = null;
  try {
    const result = await generateOpenRouterAnalysis({
      url: audit.finalUrl,
      device,
      findings: audit.findings,
      pageFacts: audit.pageFacts,
      pageSpeed,
    });
    aiAnalysis = result.analysis;
    warnings.push(...result.warnings);
    onProgress({
      stage: 'openrouter',
      status: aiAnalysis ? 'complete' : 'unavailable',
      message: result.analysis ? 'Evidence-based recommendations are ready.' : (result.warnings[0] ?? 'AI recommendations are unavailable.'),
    });
  } catch (error) {
    const message = `${readableServiceError(error, 'OpenRouter recommendations')} Check OPENROUTER_API_KEY, OPENROUTER_MODEL, and the free-model limits.`;
    warnings.push(message);
    onProgress({ stage: 'openrouter', status: 'unavailable', message });
  }

  let prisma = null;
  try { prisma = getPrisma(); } catch { /* Keep the audit results if Prisma cannot initialize. */ }
  const persistenceUnavailableMessage = process.env.DATABASE_URL
    ? 'PostgreSQL is configured but the Prisma client could not initialize; this scan was not saved.'
    : 'PostgreSQL is not configured; this scan was returned but not saved.';
  if (!prisma) warnings.push(persistenceUnavailableMessage);
  const scan = {
    url: audit.finalUrl,
    device,
    status: warnings.length ? 'partial' : 'completed',
    performanceScore: pageSpeed?.performanceScore ?? null,
    accessibilityScore: pageSpeed?.accessibilityScore ?? null,
    bestPracticesScore: pageSpeed?.bestPracticesScore ?? null,
    seoScore: pageSpeed?.seoScore ?? null,
    overallScore: calculatedOverall(pageSpeed),
    coreWebVitals: pageSpeed?.coreWebVitals ?? null,
    technicalFindings: { pageFacts: audit.pageFacts, findings: audit.findings },
    pageSpeedData: pageSpeed,
    aiAnalysis,
    serviceWarnings: warnings,
    issues: audit.findings,
    recommendations: aiAnalysis
      ? [...new Map([
        ...aiAnalysis.prioritizedActionPlan,
        ...aiAnalysis.seoRecommendations,
        ...aiAnalysis.technicalSeoRecommendations,
        ...aiAnalysis.performanceRecommendations,
        ...aiAnalysis.contentRecommendations,
        ...aiAnalysis.accessibilityRecommendations,
      ].map((item) => [`${item.category}:${item.title.toLowerCase()}`, item])).values()]
      : [],
  };

  if (prisma) {
    onProgress({ stage: 'persistence', status: 'running', message: 'Saving the scan, findings, and recommendations to PostgreSQL.' });
    try {
      const saved = await prisma.scan.create({
        data: {
          url: scan.url,
          device: scan.device,
          status: scan.status,
          performanceScore: scan.performanceScore,
          accessibilityScore: scan.accessibilityScore,
          bestPracticesScore: scan.bestPracticesScore,
          seoScore: scan.seoScore,
          overallScore: scan.overallScore,
          coreWebVitals: scan.coreWebVitals ?? undefined,
          technicalFindings: scan.technicalFindings,
          pageSpeedData: scan.pageSpeedData ?? undefined,
          aiAnalysis: scan.aiAnalysis ?? undefined,
          serviceWarnings: scan.serviceWarnings,
          issues: { create: scan.issues },
          recommendations: {
            create: scan.recommendations.map(({ category, title, priority, explanation, whyItMatters, action, exampleCode, evidenceRefs }) => ({
              category, title, priority, explanation, whyItMatters, action,
              exampleCode: exampleCode || null,
              evidenceRefs,
            })),
          },
        },
      });
      onProgress({ stage: 'persistence', status: 'complete', message: 'The scan was saved to PostgreSQL.' });
      const result = { ...scan, id: saved.id, scannedAt: saved.scannedAt.toISOString(), persisted: true };
      onProgress({ stage: 'complete', status: result.status, message: 'The website scan is complete.' });
      return result;
    } catch (error) {
      const code = typeof error?.code === 'string' && /^P\d{4}$/.test(error.code) ? error.code : null;
      console.error('[scan] PostgreSQL persistence failed', { name: error?.name ?? 'Error', code });
      const message = `This report could not be saved to PostgreSQL${code ? ` (${code})` : ''}. Check database connectivity and schema.`;
      const result = {
        ...scan,
        status: 'partial',
        id: null,
        scannedAt: new Date().toISOString(),
        persisted: false,
        serviceWarnings: [...warnings, message],
      };
      onProgress({ stage: 'persistence', status: 'unavailable', message });
      onProgress({ stage: 'complete', status: result.status, message: 'The scan finished, but the report was not saved.' });
      return result;
    }
  }

  onProgress({ stage: 'persistence', status: 'unavailable', message: persistenceUnavailableMessage });
  const result = { ...scan, id: null, scannedAt: new Date().toISOString(), persisted: false };
  onProgress({ stage: 'complete', status: result.status, message: 'The website scan is complete with the configured analysis services.' });
  return result;
}
