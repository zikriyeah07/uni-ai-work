import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAiAnalysis } from '../src/services/ai-analysis.service.js';

const originalKey = process.env.OPENROUTER_API_KEY;
const originalModel = process.env.OPENROUTER_MODEL;
const originalGeminiKey = process.env.GEMINI_API_KEY;
const originalGeminiModel = process.env.GEMINI_MODEL;
const originalProviderOrder = process.env.AI_PROVIDER_ORDER;

function restoreEnv() {
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.OPENROUTER_MODEL;
  else process.env.OPENROUTER_MODEL = originalModel;
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
  if (originalGeminiModel === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = originalGeminiModel;
  if (originalProviderOrder === undefined) delete process.env.AI_PROVIDER_ORDER;
  else process.env.AI_PROVIDER_ORDER = originalProviderOrder;
}
function useOpenRouterOnly() {
  process.env.AI_PROVIDER_ORDER = 'openrouter,gemini';
  delete process.env.GEMINI_API_KEY;
}

function input() {
  return {
    findings: [
      { key: 'missing-title', category: 'SEO', title: 'Page title is missing', priority: 'high', description: 'This page has no non-empty title element.', howToFix: 'Add a concise title element.' },
      { key: 'missing-image-alt', category: 'Accessibility', title: 'Images are missing alt text', priority: 'medium', description: 'Some images have no alternative text.', howToFix: 'Add meaningful alt text to informative images.' },
      { key: 'missing-canonical', category: 'Technical SEO', title: 'Canonical URL is missing', priority: 'medium', description: 'The page has no canonical link.', howToFix: 'Add a canonical link for this page.' },
      { key: 'missing-description', category: 'SEO', title: 'Meta description is missing', priority: 'medium', description: 'This page has no meta description.', howToFix: 'Add a concise description of the page.' },
    ],
    pageFacts: { title: null, titleLength: 0, headings: [], h1Count: 1, imagesMissingAlt: 0, brokenInternalLinks: [] },
    pageSpeed: {
      performanceScore: 76, accessibilityScore: 94, bestPracticesScore: 95, seoScore: 88,
      coreWebVitals: {
        lcp: { value: 4300, displayValue: '4.3 s', rating: 'poor', source: 'URL field data' },
        cls: { value: 0.04, displayValue: '0.040', rating: 'good', source: 'URL field data' },
        inp: { value: 120, displayValue: '120 ms', rating: 'good', source: 'URL field data' },
      },
      opportunities: [{ id: 'image-delivery', title: 'Improve image delivery', description: 'Some images can be delivered more efficiently.', displayValue: 'Potential savings of 400 KiB', savingsMs: 400 }],
      diagnostics: [],
    },
  };
}

function recommendation(category, evidenceRefs, overrides = {}) {
  return {
    category,
    priority: 'High',
    explanation: 'The cited audit evidence confirms an issue that should be corrected.',
    whyItMatters: 'Resolving this issue helps visitors use the site and find relevant information.',
    action: 'Apply the documented fix, then rerun the audit to confirm the result.',
    exampleCode: '',
    evidenceRefs,
    ...overrides,
  };
}

function response(overrides = {}) {
  return {
    websiteSummary: 'The audit found several confirmed issues that are ready to address.',
    overallAssessment: 'The measured findings identify focused work for the website team.',
    topProblems: [
      { evidenceRef: 'audit:missing-title', whyItMatters: 'A descriptive title helps visitors identify this page in search results.' },
      { evidenceRef: 'pagespeed:category:performanceScore', whyItMatters: 'A lower measured performance category can indicate friction during page use.' },
      { evidenceRef: 'pagespeed:vital:lcp', whyItMatters: 'Slow content rendering can make visitors wait before seeing the main page.' },
    ],
    seoRecommendations: [recommendation('SEO', ['audit:missing-title'])],
    technicalSeoRecommendations: [recommendation('Technical SEO', ['audit:missing-canonical'])],
    performanceRecommendations: [recommendation('Performance', ['pagespeed:vital:lcp'])],
    contentRecommendations: [recommendation('Content', ['audit:missing-description'])],
    accessibilityRecommendations: [recommendation('Accessibility', ['audit:missing-image-alt'])],
    prioritizedActionPlan: [recommendation('SEO', ['audit:missing-title'])],
    ...overrides,
  };
}

function fakeOpenRouter(result, inspect = () => {}) {
  return async (request) => {
    inspect(request);
    return { text: JSON.stringify(result), model: 'openrouter/free', annotations: [], finishReason: 'stop' };
  };
}

test('uses OpenRouter structured chat output and returns validated, evidence-linked categories', async (t) => {
  useOpenRouterOnly();
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_MODEL = 'openrouter/free';
  t.after(restoreEnv);
  let request;
  const result = await generateAiAnalysis(input(), {
    requestOpenRouter: fakeOpenRouter(response(), (payload) => { request = payload; }),
  });

  assert.equal(result.model, 'openrouter/free');
  assert.equal(result.analysis.topProblems[0].title, 'Page title is missing');
  assert.equal(result.analysis.topProblems[0].priority, 'high');
  assert.equal(result.analysis.seoRecommendations[0].title, 'Page title is missing');
  assert.equal(result.analysis.seoRecommendations[0].evidence[0].ref, 'audit:missing-title');
  assert.equal(result.analysis.performanceRecommendations[0].evidence[0].title, 'Largest Contentful Paint poor');
  assert.equal(result.analysis.technicalSeoRecommendations[0].evidence[0].ref, 'audit:missing-canonical');
  assert.equal(result.analysis.contentRecommendations[0].evidence[0].ref, 'audit:missing-description');
  assert.equal(result.analysis.accessibilityRecommendations[0].evidence[0].ref, 'audit:missing-image-alt');
  assert.equal(request.schemaName, 'site_audit_recommendations');
  assert.equal(request.maxTokens, 6000);
  assert.equal(request.timeoutMs, 70000);
  assert.match(request.messages[0].content, /Do not invent scores, metrics, broken links/);
  assert.ok(request.messages[1].content.includes('pagespeed:vital:lcp'));
  assert.ok(request.messages[1].content.includes('"performance":76'));
  assert.ok(request.messages[1].content.includes('"value":4300'));
});

test('returns a friendly unavailable result when the API key is missing', async (t) => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GEMINI_API_KEY;
  process.env.AI_PROVIDER_ORDER = 'openrouter,gemini';
  let requestSent = false;
  t.after(restoreEnv);
  const result = await generateAiAnalysis(input(), { requestOpenRouter: async () => { requestSent = true; } });
  assert.equal(result.analysis, null);
  assert.match(result.warnings[0], /OPENROUTER_API_KEY/);
  assert.equal(requestSent, false);
});

test('rejects generated recommendations that cite evidence the audit did not detect', async (t) => {
  useOpenRouterOnly();
  process.env.OPENROUTER_API_KEY = 'test-key';
  t.after(restoreEnv);
  const bad = response({ seoRecommendations: [recommendation('SEO', ['audit:invented-finding'])] });
  await assert.rejects(generateAiAnalysis(input(), { requestOpenRouter: fakeOpenRouter(bad) }), { code: 'AI_INVALID_RESPONSE' });
});

test('rejects invented numeric metrics in recommendation text', async (t) => {
  useOpenRouterOnly();
  process.env.OPENROUTER_API_KEY = 'test-key';
  t.after(restoreEnv);
  const bad = response({
    performanceRecommendations: [recommendation('Performance', ['pagespeed:vital:lcp'], { explanation: 'The score of 99 proves the page has an issue.' })],
  });
  await assert.rejects(generateAiAnalysis(input(), { requestOpenRouter: fakeOpenRouter(bad) }), { code: 'AI_INVALID_RESPONSE' });
});

test('turns free-model limit and timeout failures into friendly service errors', async (t) => {
  useOpenRouterOnly();
  process.env.OPENROUTER_API_KEY = 'test-key';
  t.after(restoreEnv);
  await assert.rejects(generateAiAnalysis(input(), {
    requestOpenRouter: async () => { throw Object.assign(new Error('rate limit'), { status: 429 }); },
  }), { code: 'OPENROUTER_RATE_LIMIT', message: /free-model limits/ });
  await assert.rejects(generateAiAnalysis(input(), {
    requestOpenRouter: async () => { throw Object.assign(new Error('request timed out'), { name: 'TimeoutError' }); },
  }), { code: 'OPENROUTER_TIMEOUT', message: /timed out/ });
});

test('falls back to Gemini for SiteSense recommendations when OpenRouter is unavailable', async (t) => {
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  process.env.AI_PROVIDER_ORDER = 'openrouter,gemini';
  t.after(restoreEnv);
  const calls = [];
  const result = await generateAiAnalysis(input(), {
    requestOpenRouter: async () => { calls.push('openrouter'); throw Object.assign(new Error('rate limit'), { status: 429 }); },
    requestGemini: async () => {
      calls.push('gemini');
      return { text: JSON.stringify(response()), model: 'gemini-3.5-flash-lite', finishReason: 'STOP' };
    },
  });
  assert.deepEqual(calls, ['openrouter', 'gemini']);
  assert.equal(result.provider, 'gemini');
  assert.equal(result.fallbackUsed, true);
  assert.match(result.warnings[0], /Gemini provided the result/);
  assert.equal(result.analysis.topProblems[0].title, 'Page title is missing');
});
