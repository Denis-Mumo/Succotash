const test = require('node:test');
const assert = require('node:assert/strict');
const { buildScanUrl, normalizePublicBaseUrl } = require('../src/utils/scan-url');

test('PUBLIC_BASE_URL overrides localhost and normalizes trailing slash', () => {
  const base = normalizePublicBaseUrl('http://192.168.1.25:3000/');
  assert.equal(buildScanUrl({ protocol: 'http', get: () => 'localhost:3000' }, 'test-token', base), 'http://192.168.1.25:3000/q/test-token');
});

test('PUBLIC_BASE_URL rejects credentials, paths and non-HTTP schemes', () => {
  for (const value of ['javascript:alert(1)', 'http://user:pass@example.test', 'https://example.test/path']) {
    assert.throws(() => normalizePublicBaseUrl(value), /PUBLIC_BASE_URL/);
  }
});

test('scan URL falls back to the dashboard host when no fixed base is configured', () => {
  assert.equal(buildScanUrl({ protocol: 'https', get: () => 'rewards.office.example' }, 'abc', ''), 'https://rewards.office.example/q/abc');
});
