import test from 'node:test';
import assert from 'node:assert/strict';
import { executeScan } from '../src/services/scan.service.js';

const audit = {
  finalUrl: 'https://public.example/',
  findings: [{ key: 'missing-title', category: 'SEO', title: 'Missing title', priority: 'high', description: 'Title is absent.', howToFix: 'Add a title.' }],
  pageFacts: { title: null, robotsTxtAvailable: true },
};
const pageSpeed = {
  performanceScore: 88, accessibilityScore: 95, bestPracticesScore: 91, seoScore: 83,
  coreWebVitals: { lcp: { value: 2000, source: 'URL field data' } }, opportunities: [], diagnostics: [],
};
const recommendation = {
  category: 'SEO', title: 'Add the missing page title', priority: 'High',
  explanation: 'The audit detected an empty title element.', whyItMatters: 'A descriptive title helps people identify the right page.',
  action: 'Write a clear title and add it inside the page head.', exampleCode: '<title>Page name</title>',
  evidenceRefs: ['audit:missing-title'], evidence: [{ ref: 'audit:missing-title', title: 'Missing title', detail: 'No title element.' }],
};
const analysis = {
  websiteSummary: 'A public website with an identified SEO issue.',
  overallAssessment: 'The HTML audit found a missing page title.',
  topProblems: ['The page title is missing.'], seoRecommendations: [recommendation], performanceRecommendations: [],
  technicalSeoRecommendations: [], contentRecommendations: [], accessibilityRecommendations: [], prioritizedActionPlan: [recommendation],
};

test('runs the complete workflow and returns measured findings for the browser session', async () => {
  const progress = [];
  const dependencies = {
    auditWebsite: async (url, options) => { assert.equal(url, 'https://public.example/'); options.onProgress({ stage: 'html', status: 'complete', message: 'HTML ready.' }); return audit; },
    runPageSpeed: async (_url, device) => { assert.equal(device, 'desktop'); return pageSpeed; },
    generateAiAnalysis: async () => ({ analysis, warnings: [] }),
  };
  const result = await executeScan({ url: 'https://public.example/', device: 'desktop', onProgress: (event) => progress.push(event) }, dependencies);
  assert.equal(result.status, 'completed');
  assert.equal(result.sessionOnly, true);
  assert.equal(result.id, null);
  assert.equal(result.overallScore, 89);
  assert.equal(result.performanceScore, 88);
  assert.deepEqual(result.coreWebVitals, pageSpeed.coreWebVitals);
  assert.equal(result.issues[0].key, 'missing-title');
  assert.equal(result.aiAnalysis.websiteSummary, analysis.websiteSummary);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].whyItMatters, recommendation.whyItMatters);
  assert.ok(progress.some(({ stage, status }) => stage === 'pagespeed' && status === 'complete'));
  assert.ok(progress.some(({ stage }) => stage === 'complete'));
});

test('returns the real HTML findings when optional services fail', async () => {
  const progress = [];
  const dependencies = {
    auditWebsite: async () => audit,
    runPageSpeed: async () => { throw new Error('PageSpeed quota was reached.'); },
    generateAiAnalysis: async () => { throw new Error('AI providers unavailable.'); },
  };
  const result = await executeScan({ url: 'https://public.example/', device: 'mobile', onProgress: (event) => progress.push(event) }, dependencies);
  assert.equal(result.status, 'partial');
  assert.equal(result.sessionOnly, true);
  assert.equal(result.performanceScore, null);
  assert.equal(result.technicalFindings.findings[0].key, 'missing-title');
  assert.equal(result.aiAnalysis, null);
  assert.ok(result.serviceWarnings.some((warning) => warning.includes('PageSpeed quota')));
  assert.ok(result.serviceWarnings.some((warning) => warning.includes('AI recommendations failed: AI providers unavailable')));
  assert.ok(progress.some(({ stage, status }) => stage === 'pagespeed' && status === 'unavailable'));
  assert.ok(progress.some(({ stage, status }) => stage === 'ai' && status === 'unavailable'));
});

test('fails a scan when the required HTML audit cannot run', async () => {
  await assert.rejects(executeScan({ url: 'http://127.0.0.1/', device: 'mobile' }, {
    auditWebsite: async () => { throw Object.assign(new Error('Private hosts are blocked.'), { code: 'UNSAFE_HOST' }); },
    runPageSpeed: async () => pageSpeed,
    generateAiAnalysis: async () => ({ analysis, warnings: [] }),
  }), { code: 'UNSAFE_HOST' });
});

test('does not calculate a combined score when a PageSpeed category is missing', async () => {
  const result = await executeScan({ url: 'https://public.example/', device: 'mobile' }, {
    auditWebsite: async () => audit,
    runPageSpeed: async () => ({ performanceScore: 88, accessibilityScore: null, bestPracticesScore: 91, seoScore: 83 }),
    generateAiAnalysis: async () => ({ analysis, warnings: [] }),
  });
  assert.equal(result.performanceScore, 88);
  assert.equal(result.overallScore, null);
});
