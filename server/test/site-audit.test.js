import test from 'node:test';
import assert from 'node:assert/strict';
import { auditWebsite } from '../src/services/site-audit.service.js';

const html = `<!doctype html><html><head><title></title>
  <meta name="description" content="Short">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://audit.example.test/article?token=secret">
  <meta property="og:title" content="Audit page">
  <meta property="og:description" content="Summary">
  <meta property="og:image" content="https://audit.example.test/cover.png">
  </head><body><h1> </h1><h1>Second heading</h1><h2>Section</h2>
  <img src="/photo.jpg?private=secret"><img src="data:image/png;base64,abc" alt="">
  <a href="/good?session=secret">Good</a><a href="/broken?token=secret">Missing</a><a href="mailto:hi@example.test">Mail</a>
  </body></html>`;

test('extracts page facts, reports SEO problems, checks links and validates site files', async () => {
  const progress = [];
  const calls = [];
  const fetcher = async (url, options = {}) => {
    const target = new URL(url);
    calls.push({ url: target, method: options.method ?? 'GET' });
    if (target.pathname === '/') return { status: 200, headers: { 'content-type': 'text/html' }, body: html, url: 'https://audit.example.test/' };
    if (target.pathname === '/good') return { status: 200, headers: { 'content-type': 'text/html' }, body: '', url: target.toString() };
    if (target.pathname === '/broken') return { status: 404, headers: { 'content-type': 'text/html' }, body: '', url: target.toString() };
    if (target.pathname === '/robots.txt') return { status: 200, headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nSitemap: https://audit.example.test/sitemap.xml\n', url: target.toString() };
    if (target.pathname === '/sitemap.xml') return { status: 200, headers: { 'content-type': 'application/xml' }, body: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', url: target.toString() };
    return { status: 404, headers: { 'content-type': 'text/html' }, body: '', url: target.toString() };
  };

  const report = await auditWebsite('https://audit.example.test/', { fetcher, onProgress: (event) => progress.push(event) });
  assert.equal(report.finalUrl, 'https://audit.example.test/');
  assert.equal(report.pageFacts.h1Count, 2);
  assert.deepEqual(report.pageFacts.headings.map(({ level, text }) => [level, text]), [[1, 'Second heading'], [2, 'Section']]);
  assert.equal(report.pageFacts.imagesMissingAlt, 1);
  assert.equal(report.pageFacts.images[0].src, 'https://audit.example.test/photo.jpg');
  assert.equal(report.pageFacts.links.find(({ text }) => text === 'Good').href, 'https://audit.example.test/good');
  assert.equal(report.pageFacts.canonicalResolved, 'https://audit.example.test/article');
  assert.equal(report.pageFacts.robotsTxtAvailable, true);
  assert.equal(report.pageFacts.sitemapAvailable, true);
  assert.equal(report.pageFacts.brokenInternalLinks.length, 1);
  assert.equal(report.pageFacts.brokenInternalLinks[0].url, 'https://audit.example.test/broken');
  assert.ok(report.findings.some(({ key }) => key === 'short-description'));
  assert.ok(report.findings.some(({ key }) => key === 'empty-h1'));
  assert.ok(report.findings.some(({ key }) => key === 'multiple-h1'));
  assert.ok(report.findings.some(({ key }) => key === 'missing-image-alt'));
  assert.ok(report.findings.some(({ key }) => key === 'broken-internal-links'));
  assert.ok(calls.some(({ url, method }) => url.pathname === '/sitemap.xml' && method === 'GET'));
  assert.deepEqual([...new Set(progress.map(({ stage }) => stage))], ['html', 'links', 'site-files']);
});

test('does not count a catch-all HTML page as robots.txt or a sitemap', async () => {
  const fetcher = async (url) => {
    const target = new URL(url);
    if (target.pathname === '/') return { status: 200, headers: { 'content-type': 'text/html' }, body: '<html><head><title>Catch all</title></head></html>', url: target.toString() };
    return { status: 200, headers: { 'content-type': 'text/html' }, body: '<html><body>Not found</body></html>', url: target.toString() };
  };
  const report = await auditWebsite('https://audit.example.test/', { fetcher });
  assert.equal(report.pageFacts.robotsTxtAvailable, false);
  assert.equal(report.pageFacts.sitemapAvailable, false);
  assert.ok(report.findings.some(({ key }) => key === 'missing-robots'));
  assert.ok(report.findings.some(({ key }) => key === 'missing-sitemap'));
});

test('reports missing description, H1, canonical, viewport, and Open Graph metadata', async () => {
  const fetcher = async (url, options = {}) => {
    const target = new URL(url);
    if (target.pathname === '/') return { status: 200, headers: { 'content-type': 'text/html' }, body: '<html><head><title>Simple page</title></head><body><p>Text</p></body></html>', url: target.toString() };
    if (target.pathname === '/robots.txt' && options.method === 'GET') return { status: 404, headers: {}, body: '', url: target.toString() };
    return { status: 404, headers: {}, body: '', url: target.toString() };
  };
  const report = await auditWebsite('https://audit.example.test/', { fetcher });
  const keys = new Set(report.findings.map(({ key }) => key));
  for (const key of ['missing-description', 'missing-h1', 'missing-canonical', 'missing-viewport', 'missing-open-graph', 'missing-robots', 'missing-sitemap']) assert.ok(keys.has(key), `expected ${key}`);
  assert.equal(report.pageFacts.title, 'Simple page');
  assert.equal(report.pageFacts.description, null);
  assert.equal(report.pageFacts.hasViewport, false);
  assert.deepEqual(report.pageFacts.openGraphMissing, ['og:title', 'og:description', 'og:image']);
});

test('checks at most five internal links concurrently and caps checks at 24 unique targets', async () => {
  let active = 0;
  let peak = 0;
  const anchors = Array.from({ length: 30 }, (_, index) => `<a href="/target-${index}">Link ${index}</a>`).join('');
  const fetcher = async (url) => {
    const target = new URL(url);
    if (target.pathname === '/') return { status: 200, headers: { 'content-type': 'text/html' }, body: `<html><head><title>Links</title></head><body>${anchors}</body></html>`, url: target.toString() };
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { status: 200, headers: {}, body: '', url: target.toString() };
  };
  const report = await auditWebsite('https://audit.example.test/', { fetcher });
  assert.equal(report.pageFacts.internalLinksFound, 30);
  assert.equal(report.pageFacts.internalLinksChecked, 24);
  assert.ok(peak <= 5);
});
