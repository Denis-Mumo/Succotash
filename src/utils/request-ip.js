const { isIP } = require('node:net');

function requestIp(req, isVercel = false) {
  if (isVercel) {
    // Vercel overwrites this header at its edge. Reject lists and malformed values rather than guess.
    const forwarded = req.get ? req.get('x-forwarded-for') : req.headers?.['x-forwarded-for'];
    const value = typeof forwarded === 'string' ? forwarded.trim() : '';
    return value && !value.includes(',') && isIP(value) ? value : 'unknown';
  }
  const value = typeof req.ip === 'string' ? req.ip : '';
  return value && isIP(value) ? value : 'unknown';
}

module.exports = { requestIp };
