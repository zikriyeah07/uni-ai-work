import test from 'node:test';
import assert from 'node:assert/strict';
import { runPageSpeed } from '../src/services/pagespeed.service.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env.PAGESPEED_API_KEY;

function fixture() {
  return {
    analysisUTCTimestamp: '2026-11-03T00:00:00.000Z',
    id: 'https://www.example.com/',
    loadingExperience: {
      overall_category: 'FAST',
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100, category: 'FAST' },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 80, category: 'FAST' },
        INTERACTION_TO_NEXT_PAINT: { percentile: 180, category: 'FAST' },
      },
    },
    lighthouseResult: {
      categories: {
        performance: { score: 0.91 }, accessibility: { score: 0.98 },
        'best-practices': { score: 0.87 }, seo: { score: 0.94 },
      },
      audits: {
        'largest-contentful-paint': { title: 'LCP', numericValue: 2600, displayValue: '2.6 s' },
        'first-contentful-paint': { title: 'FCP', displayValue: '1.0 s' },
        'image-delivery': { title: 'Improve image delivery', score: 0.3, details: { type: 'opportunity', overallSavingsMs: 300, items: [] } },
        'unused-css': { title: 'Unused CSS', score: 0.4, details: { type: 'table', items: [] } },
      },
    },
  };
}

test('requests the selected strategy and maps only PageSpeed response values', async (t) => {
  process.env.PAGESPEED_API_KEY = 'test-key';
  let requestedUrl;
  globalThis.fetch = async (input) => {
    requestedUrl = new URL(input);
    return new Response(JSON.stringify(fixture()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.PAGESPEED_API_KEY; else process.env.PAGESPEED_API_KEY = originalKey; });

  const result = await runPageSpeed('https://www.example.com/', 'desktop');
  assert.equal(requestedUrl.searchParams.get('strategy'), 'desktop');
  assert.equal(requestedUrl.searchParams.get('key'), 'test-key');
  assert.deepEqual(['performanceScore', 'accessibilityScore', 'bestPracticesScore', 'seoScore'].map((key) => result[key]), [91, 98, 87, 94]);
  assert.deepEqual(result.coreWebVitals.lcp, { value: 2100, displayValue: '2.1 s', rating: 'good', source: 'URL field data', category: 'FAST' });
  assert.equal(result.coreWebVitals.cls.value, 0.08);
  assert.equal(result.coreWebVitals.inp.value, 180);
  assert.equal(result.coreWebVitals.fcp, '1.0 s');
  assert.equal(result.opportunities[0].title, 'Improve image delivery');
  assert.equal(result.diagnostics[0].title, 'Unused CSS');
});

test('uses actual Lighthouse lab vitals when field data is absent and preserves missing metrics', async (t) => {
  const data = fixture();
  data.loadingExperience = { metrics: {} };
  delete data.lighthouseResult.audits['largest-contentful-paint'];
  globalThis.fetch = async () => new Response(JSON.stringify(data), { status: 200 });
  t.after(() => { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.PAGESPEED_API_KEY; else process.env.PAGESPEED_API_KEY = originalKey; });

  const result = await runPageSpeed('https://www.example.com/', 'mobile');
  assert.equal(result.coreWebVitals.lcp, null);
  assert.equal(result.coreWebVitals.cls, null);
  assert.equal(result.coreWebVitals.inp, null);
  assert.equal(result.coreWebVitals.fieldDataAvailable, false);
});

test('reports PageSpeed rate limits clearly', async (t) => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 429 });
  t.after(() => { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.PAGESPEED_API_KEY; else process.env.PAGESPEED_API_KEY = originalKey; });
  await assert.rejects(runPageSpeed('https://www.example.com/'), { code: 'PAGESPEED_RATE_LIMIT' });
});
