import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { AppError } from '../utils/errors.js';

const BLOCKED_HOSTS = new Set(['metadata.google.internal', 'metadata.google', 'metadata', 'instance-data']);

function ipv4Number(ip) {
  return ip.split('.').reduce((acc, part) => (acc * 256) + Number(part), 0);
}

function inCidr(ip, base, bits) {
  const shift = 32 - bits;
  return (ipv4Number(ip) >>> shift) === (ipv4Number(base) >>> shift);
}

function isPublicIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) {
    const blocked = [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
      ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
    ];
    return !blocked.some(([base, bits]) => inCidr(ip, base, bits));
  }
  if (family === 6) {
    const value = ip.toLowerCase().split('%')[0];
    // Permit global unicast (2000::/3) only; reject documentation, 6to4 and Teredo ranges.
    const groups = value.split(':');
    const firstGroup = Number.parseInt(groups[0], 16);
    const secondGroup = Number.parseInt(groups[1] || '0', 16);
    return /^2[0-9a-f]{3}:/.test(value)
      && !(firstGroup === 0x2001 && secondGroup === 0x0db8)
      && !(firstGroup === 0x2001 && secondGroup <= 0x01ff)
      && firstGroup !== 0x3fff
      && !value.startsWith('2002:');
  }
  return false;
}

export function normalizeUrl(input) {
  if (typeof input !== 'string' || !input.trim()) throw new AppError('Enter a website URL to scan.', 400, 'INVALID_URL');
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) {
    const isHostPort = /^[^:/?#]+:\d+(?:[/?#]|$)/.test(raw);
    if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !isHostPort) {
      throw new AppError('Only HTTP and HTTPS websites can be scanned.', 400, 'INVALID_URL');
    }
    raw = `https://${raw}`;
  }
  let parsed;
  try { parsed = new URL(raw); } catch { throw new AppError('Enter a valid HTTP or HTTPS website URL.', 400, 'INVALID_URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new AppError('Only HTTP and HTTPS websites can be scanned.', 400, 'INVALID_URL');
  if (parsed.username || parsed.password) throw new AppError('URLs with embedded credentials are not allowed.', 400, 'INVALID_URL');
  parsed.hash = '';
  return parsed;
}

export async function resolvePublicTarget(url) {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || BLOCKED_HOSTS.has(host) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new AppError('This host is local or reserved and cannot be scanned.', 400, 'UNSAFE_HOST');
  }
  if (net.isIP(host)) {
    if (!isPublicIp(host)) throw new AppError('Private or reserved IP addresses cannot be scanned.', 400, 'UNSAFE_HOST');
    return [{ address: host, family: net.isIP(host) }];
  }
  let addresses;
  let dnsTimer;
  try {
    addresses = await Promise.race([
      dns.lookup(host, { all: true, verbatim: true }),
      new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(new Error('DNS lookup timed out')), 5000); }),
    ]);
  } catch { throw new AppError('The website host could not be resolved in time.', 400, 'DNS_LOOKUP_FAILED'); }
  finally { clearTimeout(dnsTimer); }
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new AppError('This host resolves to a private or reserved address and cannot be scanned.', 400, 'UNSAFE_HOST');
  }
  return addresses;
}

function requestOnce(url, addresses, { timeoutMs, maxBytes, method }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    let settled = false;
    let hardTimeout;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      err ? reject(err) : resolve(value);
    };
    const lookup = (_hostname, options, callback) => {
      if (options?.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    };
    const req = transport.request(url, {
      method,
      headers: {
        'user-agent': 'SiteSenseAI/1.0 (+website-audit; public website scanner)',
        accept: 'text/html,application/xhtml+xml,application/xml,text/plain,*/*;q=0.5',
        'accept-encoding': 'identity',
      },
      lookup,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new AppError('The website response is larger than the scan limit.', 413, 'RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish(null, {
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        url: url.toString(),
      }));
      res.on('error', (error) => finish(error));
    });
    hardTimeout = setTimeout(() => req.destroy(new AppError('The website took too long to respond.', 504, 'WEBSITE_TIMEOUT')), timeoutMs);
    hardTimeout.unref?.();
    req.on('timeout', () => req.destroy(new AppError('The website took too long to respond.', 504, 'WEBSITE_TIMEOUT')));
    req.on('error', (error) => finish(error));
    req.end();
  });
}

export async function safeFetch(inputUrl, { timeoutMs = 10000, maxBytes = 2_000_000, method = 'GET', maxRedirects = 5 } = {}) {
  let current = inputUrl instanceof URL ? new URL(inputUrl) : normalizeUrl(inputUrl);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!['http:', 'https:'].includes(current.protocol) || current.username || current.password) {
      throw new AppError('Only public HTTP and HTTPS URLs can be fetched.', 400, 'UNSAFE_URL');
    }
    const addresses = await resolvePublicTarget(current);
    let response;
    try {
      response = await requestOnce(current, addresses, { timeoutMs, maxBytes, method });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('The website could not be reached. Check that the URL is correct and publicly accessible.', 422, 'WEBSITE_UNREACHABLE');
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.location;
    if (!location) return response;
    if (hop === maxRedirects) throw new AppError('The website redirects too many times.', 400, 'TOO_MANY_REDIRECTS');
    let next;
    try { next = new URL(location, current); } catch { throw new AppError('The website returned an invalid redirect.', 400, 'INVALID_REDIRECT'); }
    if (!['http:', 'https:'].includes(next.protocol) || next.username || next.password) {
      throw new AppError('The website redirected to an unsafe destination.', 400, 'UNSAFE_REDIRECT');
    }
    current = next;
  }
  throw new AppError('The website could not be reached safely.', 400, 'UNSAFE_REDIRECT');
}
