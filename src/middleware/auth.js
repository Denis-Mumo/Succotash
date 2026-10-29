const db = require('../database/db');
function requireAdmin(req, res, next) {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Authentication required' });
  db.get('SELECT id,email,role FROM administrators WHERE id=?', [req.session.adminId]).then(admin => {
    if (!admin) { req.session.destroy(() => {}); return res.status(401).json({ error: 'Authentication required' }); }
    req.admin = admin; next();
  }).catch(next);
}
function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin) {
    try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Request origin not allowed' }); }
    catch { return res.status(403).json({ error: 'Request origin not allowed' }); }
  }
  next();
}
function csrf(req, res, next) {
  if (!['POST','PATCH','PUT','DELETE'].includes(req.method)) return next();
  if (!req.session.csrfToken || req.get('x-csrf-token') !== req.session.csrfToken) return res.status(403).json({ error: 'Invalid CSRF token' });
  next();
}
module.exports = { requireAdmin, sameOrigin, csrf };
