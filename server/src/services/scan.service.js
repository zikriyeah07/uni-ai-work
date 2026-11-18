function calculatedOverall(pageSpeed) {
  if (!pageSpeed) return null;
  const scores = [pageSpeed.performanceScore, pageSpeed.accessibilityScore, pageSpeed.bestPracticesScore, pageSpeed.seoScore].filter(Number.isFinite);
  return scores.length === 4 ? Math.round(scores.reduce((sum, value) => sum + value, 0) / 4) : null;
}

function readableServiceError(error, serviceName) {
  let detail = typeof error?.message === 'string' ? error.message : '';
  for (const secret of [process.env.OPENROUTER_API_KEY, process.env.GEMINI_API_KEY, process.env.OPENCODE_API_KEY].filter((value) => typeof value === 'string' && value.length > 5)) {
    detail = detail.replaceAll(secret, '[redacted]');
  }
  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 320);
  return detail ? `${serviceName} failed: ${detail}` : `${serviceName} failed without returning an error message.`;
}

export async function executeScan({ url, device, onProgress = () => {} }, dependencies = {}) {
  const auditWebsite = dependencies.auditWebsite ?? (await import('./site-audit.service.js')).auditWebsite;
  const runPageSpeed = dependencies.runPageSpeed ?? (await import('./pagespeed.service.js')).runPageSpeed;
  const generateAiAnalysis = dependencies.generateAiAnalysis ?? (await import('./ai-analysis.service.js')).generateAiAnalysis;
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
  let audit;
  try {
    audit = await auditWebsite(url, { onProgress, onPageResolved: startPageSpeed });
  } catch (error) {
    if (pageSpeedTask) pageSpeedTask.catch(() => {});
    throw error;
  }
  if (!pageSpeedTask) startPageSpeed(audit.finalUrl);

  onProgress({ stage: 'ai', status: 'running', message: 'Generating recommendations from confirmed findings.' });
  let aiAnalysis = null;

  const aiTask = (async () => {
    try {
      const result = await generateAiAnalysis({
        url: audit.finalUrl,
        device,
        findings: audit.findings,
        pageFacts: audit.pageFacts,
        pageSpeed: null,
      });
      aiAnalysis = result.analysis;
      warnings.push(...(result.warnings || []));
      onProgress({
        stage: 'ai',
        status: aiAnalysis ? 'complete' : 'unavailable',
        message: result.analysis ? 'Evidence-based recommendations are ready.' : (result.warnings?.[0] ?? 'AI recommendations are unavailable.'),
      });
    } catch (error) {
      const message = `${readableServiceError(error, 'AI recommendations')} Check the configured provider keys, models, and free-tier limits.`;
      warnings.push(message);
      onProgress({ stage: 'ai', status: 'unavailable', message });
    }
  })();

  const psiTask = (async () => {
    const PAGE_SPEED_WAIT_MS = 30000;
    let outcome = await Promise.race([
      pageSpeedTask,
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), PAGE_SPEED_WAIT_MS)),
    ]);
    if (outcome?.timeout) {
      warnings.push('PageSpeed took too long, so this report continues without PageSpeed scores.');
      onProgress({ stage: 'pagespeed', status: 'unavailable', message: 'PageSpeed took too long. Continuing without PageSpeed scores.' });
      pageSpeedTask.catch(() => {});
      return;
    }
    try {
      if (outcome.error) throw outcome.error;
      pageSpeed = outcome.result;
      onProgress({ stage: 'pagespeed', status: 'complete', message: 'PageSpeed scores and available web vitals were received.' });
    } catch (error) {
      const message = error.message || 'Google PageSpeed analysis failed.';
      warnings.push(message);
      onProgress({ stage: 'pagespeed', status: 'unavailable', message: `${message} Continuing with the HTML audit.` });
    }
  })();

  await Promise.all([psiTask, aiTask]);

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

  const result = { ...scan, id: null, scannedAt: new Date().toISOString(), sessionOnly: true };
  onProgress({ stage: 'complete', status: result.status, message: 'The website scan is complete. The report is available for this browser session.' });
  return result;
}
