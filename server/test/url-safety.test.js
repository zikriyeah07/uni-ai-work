import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, resolvePublicTarget, safeFetch } from '../src/services/url-safety.service.js';

test('normalizes public URLs and removes fragments', () => {
  const url = normalizeUrl('  example.com/guide#section  ');
  assert.equal(url.toString(), 'https://example.com/guide');
  assert.equal(normalizeUrl('http://example.com').protocol, 'http:');
});

test('rejects non-web schemes and embedded credentials', () => {
  for (const value of ['ftp://example.com/file', 'javascript:alert(1)', 'https://user:pass@example.com']) {
    assert.throws(() => normalizeUrl(value), { code: 'INVALID_URL' });
  }
});

test('blocks local, private, reserved, and metadata destinations', async () => {
  for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.2', '169.254.169.254', 'metadata.google.internal', '::1', '2001:db8::1']) {
    await assert.rejects(resolvePublicTarget(new URL(`http://${host.includes(':') ? `[${host}]` : host}/`)), { code: 'UNSAFE_HOST' }, host);
  }
});

test('permits a globally routable IPv4 literal without resolving it through DNS', async () => {
  assert.deepEqual(await resolvePublicTarget(new URL('https://8.8.8.8/')), [{ address: '8.8.8.8', family: 4 }]);
});

test('rejects unsafe URL objects passed by discovered page resources', async () => {
  await assert.rejects(safeFetch(new URL('file:///etc/passwd')), { code: 'UNSAFE_URL' });
});
