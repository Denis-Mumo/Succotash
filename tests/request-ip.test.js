const test = require('node:test');
const assert = require('node:assert/strict');
const { requestIp } = require('../src/utils/request-ip');

test('Vercel client address accepts only the platform-supplied single valid IP value', () => {
  assert.equal(requestIp({ headers: { 'x-forwarded-for': '2001:db8::7' } }, true), '2001:db8::7');
  assert.equal(requestIp({ headers: { 'x-forwarded-for': 'not-an-ip' } }, true), 'unknown');
  assert.equal(requestIp({ headers: { 'x-forwarded-for': '198.51.100.8, 10.0.0.1' } }, true), 'unknown');
});

test('non-Vercel request IP uses Express trust configuration and ignores forwarding header directly', () => {
  assert.equal(requestIp({ ip: '192.0.2.5', headers: { 'x-forwarded-for': '198.51.100.8' } }), '192.0.2.5');
  assert.equal(requestIp({ ip: undefined, headers: { 'x-forwarded-for': '198.51.100.8' } }), 'unknown');
});
