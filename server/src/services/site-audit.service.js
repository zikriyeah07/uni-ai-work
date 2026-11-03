import * as cheerio from 'cheerio';
import { safeFetch, normalizeUrl } from './url-safety.service.js';
import { AppError } from '../utils/errors.js';

function issue(key, category, title, priority, description, howToFix, exampleCode = null) {
  return { key, category, title, priority, description, howToFix, exampleCode };
}

async function mapWithConcurrency(items, limit, callback) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await callback(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function checkResource(url, { method = 'HEAD', maxBytes = 16_000 } = {}, fetcher = safeFetch) {
  try {
    let response = await fetcher(url, { timeoutMs: method === 'HEAD' ? 2500 : 3500, maxBytes, maxRedirects: 3, method });
    if (method === 'HEAD' && [403, 405, 501].includes(response.status)) {
      response = await fetcher(url, { timeoutMs: 3500, maxBytes: 512_000, maxRedirects: 3, method: 'GET' });
    }
    return {
      available: response.status >= 200 && response.status < 400,
      status: response.status,
      body: response.body,
      contentType: String(response.headers?.['content-type'] ?? '').toLowerCase(),
    };
  } catch {
    return { available: false, status: null, body: '', contentType: '' };
  }
}

function looksLikeSitemap(result) {
  if (!result.available || !result.body) return false;
  const contentTypeLooksXml = /(?:application|text)\/(?:[^;]+\+)?xml/i.test(result.contentType);
  const bodyLooksXml = /<(?:\w+:)?(?:urlset|sitemapindex)\b/i.test(result.body);
  return contentTypeLooksXml || bodyLooksXml;
}

function cleanPageReference(value, baseUrl) {
  try {
    const resolved = new URL(value, baseUrl);
    if (!['http:', 'https:'].includes(resolved.protocol)) return '[non-web reference]';
    resolved.search = '';
    resolved.hash = '';
    return resolved.toString();
  } catch { return String(value).slice(0, 1000); }
}

export async function auditWebsite(rawUrl, { onProgress = () => {}, onPageResolved = () => {}, fetcher = safeFetch } = {}) {
  const requestedUrl = normalizeUrl(rawUrl);
  onProgress({ stage: 'html', status: 'running', message: 'Validating the public URL and fetching page HTML.' });
  const page = await fetcher(requestedUrl, { timeoutMs: 12000, maxBytes: 2_000_000, maxRedirects: 5 });
  if (page.status >= 400) throw new AppError(`The website returned HTTP ${page.status}. Check that the page is publicly accessible.`, 422, 'WEBSITE_HTTP_ERROR');
  const contentType = String(page.headers['content-type'] ?? '').toLowerCase();
  if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new AppError('The URL did not return an HTML page that can be audited.', 422, 'NOT_HTML');
  }
  const finalUrl = new URL(page.url);
  onPageResolved(finalUrl.toString());
  const $ = cheerio.load(page.body);
  const findings = [];
  const title = $('title').first().text().trim();
  const description = $('meta[name="description"]')
    .map((_, el) => $(el).attr('content')?.trim() ?? '').get().find(Boolean) ?? '';
  const headings = $('h1,h2,h3,h4,h5,h6').map((_, el) => ({
    level: Number(el.tagName.slice(1)),
    text: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 240),
  })).get().filter((heading) => heading.text).slice(0, 60);
  const h1Count = $('h1').length;
  const emptyH1Count = $('h1').filter((_, el) => !$(el).text().replace(/\s+/g, ' ').trim()).length;
  const images = $('img').map((_, el) => {
    const rawSrc = $(el).attr('src')?.trim() ?? '';
    const altAttribute = $(el).attr('alt');
    let src = rawSrc;
    if (src.startsWith('data:')) src = '[embedded data URI]';
    else if (src) {
      src = cleanPageReference(src, finalUrl);
    }
    return {
      src: src.slice(0, 1000) || null,
      alt: typeof altAttribute === 'string' ? altAttribute.trim().slice(0, 300) : null,
      hasAlt: typeof altAttribute !== 'undefined',
      loading: $(el).attr('loading')?.trim() || null,
    };
  }).get();
  const imageCount = images.length;
  const missingAlt = images.filter((image) => !image.hasAlt).length;
  const viewportContent = $('meta[name="viewport"]').first().attr('content')?.trim() ?? '';
  const hasViewport = viewportContent.length > 0;
  const canonical = $('link[rel~="canonical"]').first().attr('href')?.trim() ?? '';
  const ogMetadata = Object.fromEntries(['og:title', 'og:description', 'og:image', 'og:url', 'og:type'].map((property) => {
    const value = $(`meta[property="${property}"]`).first().attr('content')?.trim();
    const safeValue = value && ['og:image', 'og:url'].includes(property) ? cleanPageReference(value, finalUrl) : value;
    return [property, safeValue?.slice(0, 1000) || null];
  }));
  const ogMissing = ['og:title', 'og:description', 'og:image'].filter((property) => !ogMetadata[property]);
  const canonicalResolved = canonical ? (() => {
    try {
      const resolved = new URL(canonical, finalUrl);
      return ['http:', 'https:'].includes(resolved.protocol) ? resolved.toString() : null;
    } catch { return null; }
  })() : null;
  const links = $('a[href]').map((_, el) => {
    const href = $(el).attr('href')?.trim() ?? '';
    let isInternal = false;
    try {
      const target = new URL(href, finalUrl);
      isInternal = target.origin === finalUrl.origin && ['http:', 'https:'].includes(target.protocol);
    } catch { /* Keep malformed links in extracted page data, but do not request them. */ }
    return { href: cleanPageReference(href, finalUrl).slice(0, 2048), text: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 200), isInternal };
  }).get().slice(0, 120);
  onProgress({ stage: 'html', status: 'complete', message: 'Page HTML and metadata have been extracted.' });

  if (!title) findings.push(issue('missing-title', 'SEO', 'Page title is missing', 'high', 'Search engines and browser tabs rely on a descriptive page title. This page has no non-empty <title> element.', 'Add a unique, concise title inside the document head.', '<title>Page topic | Brand</title>'));
  else if (title.length > 60) findings.push(issue('long-title', 'SEO', 'Page title may be too long', 'low', `The title is ${title.length} characters. Search results may truncate long titles.`, 'Keep the title concise and place the most useful wording first.'));
  if (!description) findings.push(issue('missing-description', 'SEO', 'Meta description is missing', 'medium', 'Search engines may choose page text instead of a controlled search snippet.', 'Add a page-specific description that accurately summarizes the page.', '<meta name="description" content="A concise summary of this page">'));
  else if (description.length < 50) findings.push(issue('short-description', 'SEO', 'Meta description is unusually short', 'low', `The meta description is ${description.length} characters. It may not give searchers enough context.`, 'Write a concise, accurate summary of the page content.'));
  else if (description.length > 160) findings.push(issue('long-description', 'SEO', 'Meta description may be too long', 'low', `The meta description is ${description.length} characters and may be truncated in search results.`, 'Move the most useful information earlier and keep the summary concise.'));
  if (h1Count === 0) findings.push(issue('missing-h1', 'SEO', 'No H1 heading found', 'high', 'A clear main heading helps visitors and search engines understand the page topic.', 'Add one visible H1 that describes the page content.', '<h1>Describe the main topic</h1>'));
  if (emptyH1Count > 0) findings.push(issue('empty-h1', 'SEO', 'H1 headings have no text', 'high', `${emptyH1Count} of ${h1Count} H1 elements contain no readable text for visitors or search engines.`, 'Add descriptive text to each H1 heading or remove empty elements.'));
  if (h1Count > 1) findings.push(issue('multiple-h1', 'SEO', 'Multiple H1 headings found', 'low', `The page contains ${h1Count} H1 elements. A single primary heading makes the content hierarchy clearer.`, 'Keep one primary H1, then use H2 and H3 headings for sections.'));
  if (missingAlt > 0) findings.push(issue('missing-image-alt', 'Accessibility', 'Images are missing alt text', 'medium', `${missingAlt} of ${imageCount} images do not have an alt attribute. Screen readers may not be able to describe them.`, 'Add concise alt text to informative images. Use alt="" for decorative images.', '<img src="chart.png" alt="Monthly visits increased from January to March">'));
  if (!canonical) findings.push(issue('missing-canonical', 'SEO', 'Canonical URL is missing', 'medium', 'Without a canonical link, search engines may have less guidance when the same content appears at multiple URLs.', 'Add an absolute canonical URL for the preferred version of this page.', '<link rel="canonical" href="https://example.com/page">'));
  else if (!canonicalResolved) findings.push(issue('invalid-canonical', 'SEO', 'Canonical URL is invalid', 'high', 'The canonical link is not a valid HTTP or HTTPS URL.', 'Set the canonical href to the preferred absolute page URL.'));
  else if (new URL(canonicalResolved).origin !== finalUrl.origin) findings.push(issue('cross-domain-canonical', 'SEO', 'Canonical URL points to another domain', 'medium', 'The canonical URL points to a different origin, which tells search engines to prefer that domain.', 'Confirm the cross-domain canonical is intentional and points to the correct canonical page.'));
  if (!hasViewport) findings.push(issue('missing-viewport', 'Technical SEO', 'Viewport metadata is missing', 'high', 'Mobile browsers may render the page at a desktop width, which harms mobile usability.', 'Add the standard responsive viewport declaration inside the document head.', '<meta name="viewport" content="width=device-width, initial-scale=1">'));
  if (viewportContent && !/width\s*=\s*device-width/i.test(viewportContent)) findings.push(issue('problematic-viewport', 'Technical SEO', 'Viewport does not use device width', 'medium', 'The viewport metadata is present, but it does not set the layout width to the device width.', 'Use width=device-width and a sensible initial scale.', '<meta name="viewport" content="width=device-width, initial-scale=1">'));
  if (ogMissing.length) findings.push(issue('missing-open-graph', 'Social metadata', 'Open Graph metadata is incomplete', 'low', `Missing properties: ${ogMissing.join(', ')}. Shared links may use an unexpected title, description, or image.`, 'Add Open Graph title, description, and an absolute image URL.'));

  const internalHrefs = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')?.trim();
    if (!href || /^(#|mailto:|tel:|javascript:|data:)/i.test(href)) return;
    try {
      const target = new URL(href, finalUrl);
      if (target.origin === finalUrl.origin && ['http:', 'https:'].includes(target.protocol)) {
        target.hash = '';
        internalHrefs.add(target.toString());
      }
    } catch { /* Ignore malformed link values. */ }
  });
  const linksChecked = [...internalHrefs].slice(0, 24);
  onProgress({ stage: 'links', status: 'running', message: `Checking ${linksChecked.length} internal links with bounded concurrency.` });
  const linkResults = await mapWithConcurrency(linksChecked, 5, async (url) => ({ url, ...(await checkResource(url, {}, fetcher)) }));
  onProgress({ stage: 'links', status: 'complete', message: `${linksChecked.length} internal links have been checked.` });
  const brokenLinks = linkResults.filter((item) => !item.available || item.status >= 400);
  if (brokenLinks.length) {
    const brokenPaths = brokenLinks.slice(0, 5).map((item) => {
      const pathname = new URL(item.url).pathname;
      return `${pathname}${item.status ? ` (HTTP ${item.status})` : ' (unreachable)'}`;
    });
    findings.push(issue('broken-internal-links', 'Technical SEO', 'Broken internal links found', 'high', `${brokenLinks.length} of ${linksChecked.length} checked internal links failed. Affected paths: ${brokenPaths.join(', ')}.${brokenLinks.length > 5 ? ' More links are listed in the scan data.' : ''} ${internalHrefs.size > linksChecked.length ? 'The audit checked the first 24 unique internal links.' : ''}`, 'Update each link to a working destination or remove it.', null));
  }

  const robotsUrl = new URL('/robots.txt', finalUrl.origin).toString();
  onProgress({ stage: 'site-files', status: 'running', message: 'Checking robots.txt and common sitemap locations.' });
  const robots = await checkResource(robotsUrl, { method: 'GET', maxBytes: 512_000 }, fetcher);
  const referencedSitemaps = robots.body.match(/^\s*sitemap:\s*(\S+)/gim)?.map((line) => line.replace(/^\s*sitemap:\s*/i, '').trim()) ?? [];
  const commonSitemaps = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/wp-sitemap.xml']
    .map((path) => new URL(path, finalUrl.origin).toString());
  const sitemapCandidates = [...new Set([...referencedSitemaps, ...commonSitemaps])].slice(0, 5);
  const sitemapResults = await Promise.all(sitemapCandidates.map((candidate) => checkResource(candidate, { method: 'GET', maxBytes: 2_000_000 }, fetcher)));
  const sitemap = sitemapResults.find(looksLikeSitemap) ?? { available: false, status: null };
  const robotsAvailable = robots.available && !/text\/html|application\/xhtml/i.test(robots.contentType)
    && !/^\s*(?:<!doctype\s+html|<html\b)/i.test(robots.body);
  if (!robotsAvailable) findings.push(issue('missing-robots', 'Crawlability', 'robots.txt is unavailable', 'low', 'A robots.txt file was not found at the origin root. Search crawlers have no robots directives to read there.', 'Publish a robots.txt file at the domain root, even if it only allows crawling.'));
  if (!sitemap.available) findings.push(issue('missing-sitemap', 'Crawlability', 'XML sitemap is unavailable', 'low', 'No sitemap was found in robots.txt or at the common sitemap locations. Crawlers may have less help discovering key URLs.', 'Publish a sitemap and reference its location from robots.txt.'));
  onProgress({ stage: 'site-files', status: 'complete', message: 'robots.txt and sitemap checks are complete.' });

  return {
    requestedUrl: requestedUrl.toString(),
    finalUrl: finalUrl.toString(),
    findings,
    pageFacts: {
      title: title || null,
      titleLength: title.length,
      description: description || null,
      headings,
      h1Count,
      emptyH1Count,
      imageCount,
      images: images.slice(0, 100),
      imagesMissingAlt: missingAlt,
      internalLinksFound: internalHrefs.size,
      internalLinksChecked: linksChecked.length,
      links,
      brokenInternalLinks: brokenLinks.map((item) => ({ url: cleanPageReference(item.url, finalUrl), status: item.status })),
      canonical: canonicalResolved ? cleanPageReference(canonical, finalUrl) : (canonical ? '[invalid canonical]' : null),
      canonicalResolved: canonicalResolved ? cleanPageReference(canonicalResolved, finalUrl) : null,
      hasViewport,
      viewportContent: viewportContent || null,
      openGraph: ogMetadata,
      openGraphMissing: ogMissing,
      robotsTxtAvailable: robotsAvailable,
      sitemapAvailable: sitemap.available,
    },
  };
}
