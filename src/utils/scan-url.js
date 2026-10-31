function normalizePublicBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let url;
  try { url = new URL(raw); }
  catch { throw new Error('PUBLIC_BASE_URL must be an absolute HTTP or HTTPS URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_BASE_URL must contain only an HTTP(S) scheme, host and optional port');
  }
  return url.origin;
}

function buildScanUrl(req, token, publicBaseUrl = '') {
  const origin = publicBaseUrl || `${req.protocol}://${req.get('host')}`;
  return `${origin}/q/${encodeURIComponent(token)}`;
}

module.exports = { normalizePublicBaseUrl, buildScanUrl };
