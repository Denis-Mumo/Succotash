const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const crypto = require('node:crypto');
const path = require('node:path');
const { z } = require('zod');
const config = require('./config/env');
const db = require('./database/db');
const { requireAdmin, sameOrigin, csrf } = require('./middleware/auth');
const { buildReport, percent } = require('./utils/analytics');
const { parseRoster } = require('./utils/csv');
const { companies, normalizeKenyanPhone, normalizeStaffNumber } = require('./utils/assessment');
const { buildScanUrl } = require('./utils/scan-url');
const createAwarenessRouter = require('./routes/awareness-assessments');

if (config.nodeEnv === 'production' && config.sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters in production');
const app = express();
app.disable('x-powered-by');
// Trust forwarding headers only from explicitly configured proxy addresses/networks.
if (config.trustedProxyCidrs.length) app.set('trust proxy', config.trustedProxyCidrs);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'], styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '8kb' }));
app.use(session({
  store: new SQLiteStore({ dir: path.dirname(config.databasePath), db: path.basename(config.databasePath), table: 'web_sessions', concurrentDB: true }),
  name: 'qr_assessment.sid', secret: config.sessionSecret, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: config.nodeEnv === 'production', maxAge: 30 * 60 * 1000 },
}));
app.use((req, res, next) => { if (req.session) req.session.cookie.maxAge = 30 * 60 * 1000; next(); });
app.use(express.static(path.join(config.root, 'public'), { index: 'index.html', fallthrough: true, setHeaders: res => res.setHeader('X-Content-Type-Options','nosniff') }));

const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const uuid = () => crypto.randomUUID();
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const audit = (adminId, action, type, id, details = {}) => db.run('INSERT INTO audit_logs(administrator_id,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)', [adminId, action, type, id == null ? null : String(id), JSON.stringify(details)]);
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many login attempts. Try again later.' } });
const assessmentLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts. Please wait and try again.' } });
const string = (max = 200) => z.string().trim().max(max);
function eventFilters(query) {
  const where=[],params=[];
  if(query.qrCode){where.push('q.reference=?');params.push(String(query.qrCode).slice(0,80));}
  if(query.sourceIp){where.push('e.source_ip=?');params.push(String(query.sourceIp).slice(0,64));}
  if(query.campaignId){if(!/^\d+$/.test(String(query.campaignId)))throw Object.assign(new Error('Invalid campaign filter'),{status:400});where.push('e.campaign_id=?');params.push(Number(query.campaignId));}
  if(query.classification){where.push('e.classification=?');params.push(String(query.classification));}
  for(const [name,op] of [['from','>='],['to','<=']])if(query[name]){const value=String(query[name]);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(`${value}T00:00:00Z`)))throw Object.assign(new Error(`Invalid ${name} date`),{status:400});where.push(`e.occurred_at ${op} ?`);params.push(`${value}${name==='from'?'T00:00:00.000Z':'T23:59:59.999Z'}`);}
  return {clause:where.length?'WHERE '+where.join(' AND '):'',params};
}

app.get('/health', (req,res) => res.json({ status: 'ok' }));
app.get('/api/admin/csrf', asyncRoute((req,res) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.json({ csrfToken: req.session.csrfToken });
}));
app.post('/api/admin/login', sameOrigin, loginLimiter, csrf, asyncRoute(async (req,res) => {
  const parsed = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Email and password are required' });
  const admin = await db.get('SELECT id,email,password_hash,role FROM administrators WHERE email=? COLLATE NOCASE', [parsed.data.email]);
  if (!admin || !(await bcrypt.compare(parsed.data.password, admin.password_hash))) return res.status(401).json({ error: 'Invalid email or password' });
  await new Promise((resolve,reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
  req.session.adminId = admin.id; req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  await db.run('UPDATE administrators SET last_login_at=strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id=?', [admin.id]);
  await audit(admin.id, 'login', 'administrator', admin.id);
  res.json({ admin: { email: admin.email, role: admin.role }, csrfToken: req.session.csrfToken });
}));
app.post('/api/admin/logout', sameOrigin, requireAdmin, csrf, asyncRoute(async (req,res) => {
  await audit(req.admin.id, 'logout', 'administrator', req.admin.id);
  req.session.destroy(() => { res.clearCookie('qr_assessment.sid', { httpOnly: true, sameSite: 'strict', secure: config.nodeEnv === 'production' }); res.status(204).end(); });
}));

// Public scanning records a request only; it never identifies a visitor.
app.get('/q/:token', limiter, asyncRoute(async (req,res) => {
  const token = req.params.token;
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) return res.status(404).sendFile(path.join(config.root,'public','not-found.html'));
  const code = await db.get(`SELECT q.id,q.campaign_id,q.location_id,q.reference FROM qr_codes q JOIN campaigns c ON c.id=q.campaign_id JOIN locations l ON l.id=q.location_id WHERE q.token_hash=? AND q.active=1 AND c.status='active' AND l.active=1`, [tokenHash(token)]);
  if (!code) return res.status(404).sendFile(path.join(config.root,'public','not-found.html'));
  const ua = (req.get('user-agent') || '').slice(0,300);
  const automated = /bot|crawler|spider|preview|scanner|headless|curl|wget|facebookexternalhit|slackbot/i.test(ua);
  const eventRef = uuid();
  const scannedAtUtc = new Date().toISOString();
  const sourceIp = typeof req.ip === 'string' && req.ip ? req.ip : 'unknown';
  await db.run('INSERT INTO scan_events(event_ref,campaign_id,qr_code_id,location_id,occurred_at,source_ip,classification,method,user_agent_category) VALUES(?,?,?,?,?,?,?,?,?)', [eventRef, code.campaign_id, code.id, code.location_id, scannedAtUtc, sourceIp, automated ? 'likely_automated' : 'unclassified', 'GET', automated ? 'automated_or_preview' : 'browser_or_unknown']);
  await db.run('UPDATE scan_events SET processing_status=\'processed\' WHERE event_ref=?', [eventRef]);
  res.set('Cache-Control','no-store').redirect(303, `/assessment?token=${encodeURIComponent(token)}&eventRef=${encodeURIComponent(eventRef)}`);
}));
app.post('/q/:token/continue', limiter, asyncRoute(async (req,res) => {
  const token = req.params.token; const eventRef = req.body.eventRef;
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token) || !/^[0-9a-f-]{36}$/i.test(eventRef || '')) return res.sendStatus(404);
  const code = await db.get('SELECT id FROM qr_codes WHERE token_hash=? AND active=1', [tokenHash(token)]);
  if (!code) return res.sendStatus(404);
  // A deliberate follow-up action is evidence of possible human interaction, never proof of a specific person.
  await db.run("UPDATE scan_events SET classification='possible_human' WHERE event_ref=? AND qr_code_id=? AND classification='unclassified'", [eventRef, code.id]);
  res.set('Cache-Control','no-store').type('html').send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/app.css"><main class="landing"><div class="mark">✓</div><p class="eyebrow">ASSESSMENT COMPLETE</p><h1>Thanks for taking a moment.</h1><p>Unexpected QR codes can lead to unsafe destinations. Verify the source and report anything suspicious using your organization’s approved process.</p></main></html>');
}));

app.get('/assessment', (req,res) => res.set('Cache-Control','no-store').sendFile(path.join(config.root,'public','employee-assessment.html')));

async function resolveAssessmentScan(token, eventRef) {
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token || '') || !/^[0-9a-f-]{36}$/i.test(eventRef || '')) return null;
  return db.get(`SELECT e.id scan_event_id,e.qr_code_id,e.occurred_at,e.source_ip
    FROM scan_events e JOIN qr_codes q ON q.id=e.qr_code_id
    JOIN campaigns c ON c.id=q.campaign_id JOIN locations l ON l.id=q.location_id
    WHERE e.event_ref=? AND q.token_hash=? AND q.active=1 AND c.status='active' AND l.active=1`, [eventRef, tokenHash(token)]);
}

app.post('/q/:token/assessment/start', sameOrigin, assessmentLimiter, asyncRoute(async (req,res) => {
  const scan = await resolveAssessmentScan(req.params.token, req.body.eventRef);
  const staffNumber = normalizeStaffNumber(req.body.staffNumber);
  if (!scan) return res.status(404).json({error:'This assessment link is invalid or no longer active.'});
  if (!staffNumber) return res.status(400).json({error:'Enter a valid staff number to continue.'});
  await db.run(`INSERT INTO awareness_assessments(scan_event_id,staff_number,qr_code_id,ip_address,scanned_at,status)
    VALUES(?,?,?,?,?,'started') ON CONFLICT(scan_event_id) DO NOTHING`, [scan.scan_event_id, staffNumber, scan.qr_code_id, scan.source_ip || 'unknown', scan.occurred_at]);
  const existing = await db.get('SELECT id,staff_number FROM awareness_assessments WHERE scan_event_id=?',[scan.scan_event_id]);
  if (!existing || existing.staff_number !== staffNumber) return res.status(409).json({error:'This scan has already been used to start an assessment.'});
  res.set('Cache-Control','no-store').json({ok:true});
}));

app.post('/q/:token/assessment/company', sameOrigin, assessmentLimiter, asyncRoute(async (req,res) => {
  const scan = await resolveAssessmentScan(req.params.token, req.body.eventRef);
  const staffNumber = normalizeStaffNumber(req.body.staffNumber);
  const company = req.body.company;
  if (!scan) return res.status(404).json({error:'This assessment link is invalid or no longer active.'});
  if (!staffNumber || !companies.includes(company)) return res.status(400).json({error:'Choose a valid company to continue.'});
  const updated = await db.run(`UPDATE awareness_assessments SET company=?,updated_at=?
    WHERE scan_event_id=? AND staff_number=? AND status='started' AND company IS NULL`, [company,new Date().toISOString(),scan.scan_event_id,staffNumber]);
  if (!updated.changes) {
    const current = await db.get('SELECT company,status FROM awareness_assessments WHERE scan_event_id=? AND staff_number=?',[scan.scan_event_id,staffNumber]);
    if (!current || current.status !== 'started' || current.company !== company) return res.status(409).json({error:'This assessment cannot be changed or has already been completed.'});
  }
  res.set('Cache-Control','no-store').json({ok:true});
}));

app.post('/q/:token/assessment/complete', sameOrigin, assessmentLimiter, asyncRoute(async (req,res) => {
  const scan = await resolveAssessmentScan(req.params.token, req.body.eventRef);
  const staffNumber = normalizeStaffNumber(req.body.staffNumber);
  const phoneNumber = normalizeKenyanPhone(req.body.phoneNumber);
  if (!scan) return res.status(404).json({error:'This assessment link is invalid or no longer active.'});
  if (!staffNumber) return res.status(400).json({error:'Enter a valid staff number to continue.'});
  if (!phoneNumber) return res.status(400).json({error:'Enter a valid Kenyan mobile number.'});
  const completedAt = new Date().toISOString();
  const updated = await db.run(`UPDATE awareness_assessments SET phone_number=?,completed_at=?,status='completed',updated_at=?
    WHERE scan_event_id=? AND staff_number=? AND company IN ('SKL','CHRS','POL') AND status='started' AND completed_at IS NULL`,
    [phoneNumber,completedAt,completedAt,scan.scan_event_id,staffNumber]);
  if (!updated.changes) return res.status(409).json({error:'This assessment is already complete or cannot be continued.'});
  res.set('Cache-Control','no-store').json({ok:true});
}));

const admin = express.Router();
admin.use(requireAdmin);
function requireItAdmin(req,res,next){if(req.admin?.role!=='privacy_admin')return res.status(403).json({error:'Privacy administrator role required for employee records'});next();}
admin.use('/assessments', requireItAdmin);
admin.use('/assessments', createAwarenessRouter({db,audit}));
admin.get('/me', (req,res) => res.json({ email:req.admin.email, role:req.admin.role, timezone:config.displayTimezone }));
admin.get('/dashboard', asyncRoute(async (req,res) => {
  const counts = await db.get(`SELECT (SELECT count(*) FROM campaigns WHERE status='active') active_campaigns,(SELECT count(*) FROM qr_codes) total_codes,(SELECT count(*) FROM scan_events) total_requests,(SELECT count(DISTINCT source_ip) FROM scan_events WHERE source_ip!='unknown') unique_source_ips,(SELECT count(*) FROM locations WHERE active=1) locations,(SELECT count(*) FROM scan_events WHERE classification IN ('possible_human','confirmed_human')) possible_human,(SELECT count(*) FROM scan_events WHERE classification='confirmed_human') confirmed_human,(SELECT count(DISTINCT qr_code_id) FROM scan_events WHERE classification IN ('possible_human','confirmed_human')) unique_codes,(SELECT count(*) FROM scan_events WHERE classification='likely_automated') automated`);
  const trend = await db.all(`SELECT substr(occurred_at,1,10) day,count(*) total,sum(classification='likely_automated') automated,sum(classification IN ('possible_human','confirmed_human')) possible FROM scan_events WHERE occurred_at >= datetime('now','-30 day') GROUP BY day ORDER BY day`);
  res.json({ ...counts, trend });
}));
admin.get('/campaigns', asyncRoute(async (req,res) => res.json(await db.all('SELECT c.*, (SELECT count(*) FROM qr_codes q WHERE q.campaign_id=c.id) code_count FROM campaigns c ORDER BY c.created_at DESC'))));
admin.post('/campaigns', csrf, asyncRoute(async (req,res) => {
  const s=z.object({name:string(120).min(1),description:string(2000).default(''),objective:string(1000).default(''),startsAt:z.string().datetime().optional().nullable(),endsAt:z.string().datetime().optional().nullable(),methodology:string(2000).default(''),retentionDays:z.number().int().min(1).max(3650).default(config.retentionDays)}).safeParse(req.body);
  if(!s.success)return res.status(400).json({error:'Invalid campaign details',details:s.error.flatten()});
  const x=s.data; const result=await db.run('INSERT INTO campaigns(name,description,objective,starts_at,ends_at,methodology,retention_days,responsible_admin_id) VALUES(?,?,?,?,?,?,?,?)',[x.name,x.description,x.objective,x.startsAt||null,x.endsAt||null,x.methodology,x.retentionDays,req.admin.id]);
  await audit(req.admin.id,'campaign.create','campaign',result.lastID);res.status(201).json(await db.get('SELECT * FROM campaigns WHERE id=?',[result.lastID]));
}));
admin.get('/campaigns/:id', asyncRoute(async (req,res) => { const c=await db.get('SELECT * FROM campaigns WHERE id=?',[req.params.id]); if(!c)return res.sendStatus(404); res.json({...c,locations:await db.all('SELECT DISTINCT l.* FROM locations l JOIN qr_codes q ON q.location_id=l.id WHERE q.campaign_id=?',[c.id])}); }));
admin.patch('/campaigns/:id', csrf, asyncRoute(async (req,res) => {
  const allowed=z.object({name:string(120).min(1).optional(),description:string(2000).optional(),objective:string(1000).optional(),startsAt:z.string().datetime().nullable().optional(),endsAt:z.string().datetime().nullable().optional(),methodology:string(2000).optional(),retentionDays:z.number().int().min(1).max(3650).optional()}).strict().safeParse(req.body);
  if(!allowed.success)return res.status(400).json({error:'Invalid campaign changes'}); const keys={name:'name',description:'description',objective:'objective',startsAt:'starts_at',endsAt:'ends_at',methodology:'methodology',retentionDays:'retention_days'}; const entries=Object.entries(allowed.data); if(!entries.length)return res.status(400).json({error:'No changes supplied'});
  const c=await db.get('SELECT id FROM campaigns WHERE id=?',[req.params.id]);if(!c)return res.sendStatus(404);
  const sql=entries.map(([k])=>`${keys[k]}=?`).join(',');await db.run(`UPDATE campaigns SET ${sql},updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,[...entries.map(([,v])=>v),c.id]);await audit(req.admin.id,'campaign.update','campaign',c.id);res.json(await db.get('SELECT * FROM campaigns WHERE id=?',[c.id]));
}));
admin.post('/campaigns/:id/:action', csrf, asyncRoute(async (req,res) => { const states={activate:'active',pause:'paused',complete:'completed'};const status=states[req.params.action];if(!status)return res.sendStatus(404);const c=await db.get('SELECT id FROM campaigns WHERE id=?',[req.params.id]);if(!c)return res.sendStatus(404);await db.run("UPDATE campaigns SET status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",[status,c.id]);await audit(req.admin.id,`campaign.${req.params.action}`,'campaign',c.id);res.json({id:c.id,status});}));
admin.get('/locations', asyncRoute(async (req,res) => res.json(await db.all(`SELECT l.*,count(DISTINCT CASE WHEN q.active=1 THEN q.id END) active_codes FROM locations l LEFT JOIN qr_codes q ON q.location_id=l.id GROUP BY l.id ORDER BY l.name`))));
admin.post('/locations', csrf, asyncRoute(async (req,res) => {const s=z.object({name:string(120).min(1),description:string(1000).default('')}).safeParse(req.body);if(!s.success)return res.status(400).json({error:'Invalid location'});const x=await db.run('INSERT INTO locations(name,description) VALUES(?,?)',[s.data.name,s.data.description]);await audit(req.admin.id,'location.create','location',x.lastID);res.status(201).json(await db.get('SELECT * FROM locations WHERE id=?',[x.lastID]));}));
admin.patch('/locations/:id', csrf, asyncRoute(async (req,res) => {const s=z.object({name:string(120).min(1).optional(),description:string(1000).optional(),active:z.boolean().optional()}).strict().safeParse(req.body);if(!s.success||!Object.keys(s.data||{}).length)return res.status(400).json({error:'Invalid location changes'});const row=await db.get('SELECT id FROM locations WHERE id=?',[req.params.id]);if(!row)return res.sendStatus(404);const m={name:'name',description:'description',active:'active'};const e=Object.entries(s.data);await db.run(`UPDATE locations SET ${e.map(([k])=>m[k]+'=?').join(',')} WHERE id=?`,[...e.map(([k,v])=>k==='active'?Number(v):v),row.id]);await audit(req.admin.id,'location.update','location',row.id);res.json(await db.get('SELECT * FROM locations WHERE id=?',[row.id]));}));
admin.get('/qr-codes', asyncRoute(async (req,res) => {const rows=await db.all('SELECT q.id,q.campaign_id,q.location_id,q.reference,q.label,q.active,q.created_at,q.revoked_at,c.name campaign,l.name location FROM qr_codes q JOIN campaigns c ON c.id=q.campaign_id JOIN locations l ON l.id=q.location_id ORDER BY q.created_at DESC');res.json(rows);}));
admin.post('/qr-codes/generate', csrf, asyncRoute(async (req,res) => {
  const s=z.object({campaignId:z.number().int().positive(),locationIds:z.array(z.number().int().positive()).min(1).max(100),countPerLocation:z.number().int().min(1).max(20).default(1),label:string(120).default(''),team:string(120).default(''),randomize:z.boolean().default(false)}).safeParse(req.body);
  if(!s.success)return res.status(400).json({error:'Invalid QR code generation request'});const c=await db.get('SELECT * FROM campaigns WHERE id=?',[s.data.campaignId]);if(!c)return res.status(404).json({error:'Campaign not found'});
  const ids=[...new Set(s.data.locationIds)];const locs=await db.all(`SELECT * FROM locations WHERE active=1 AND id IN (${ids.map(()=>'?').join(',')})`,ids);if(locs.length!==ids.length)return res.status(400).json({error:'One or more locations are missing or inactive'});
  if(s.data.randomize)for(let i=locs.length-1;i>0;i--){const j=crypto.randomInt(i+1);[locs[i],locs[j]]=[locs[j],locs[i]];}
  const created=[],batchId=uuid();for(let i=0;i<s.data.countPerLocation*locs.length;i++){const loc=locs[i%locs.length];const token=crypto.randomBytes(32).toString('base64url');const ref='QR-'+crypto.randomBytes(4).toString('hex').toUpperCase();const result=await db.run('INSERT INTO qr_codes(campaign_id,location_id,token_hash,reference,label) VALUES(?,?,?,?,?)',[c.id,loc.id,tokenHash(token),ref,s.data.label]);const placed=new Date().toISOString();await db.run('INSERT INTO placements(qr_code_id,campaign_id,location_id,placed_at,team,assignment_batch) VALUES(?,?,?,?,?,?)',[result.lastID,c.id,loc.id,placed,s.data.team,batchId]);const url=buildScanUrl(req,token,config.publicBaseUrl);created.push({id:result.lastID,reference:ref,location:loc.name,label:s.data.label,url,qrDataUrl:await QRCode.toDataURL(url,{width:280,margin:2})});}
  await audit(req.admin.id,'qr.generate','campaign',c.id,{count:created.length,locationIds:ids});res.status(201).json({codes:created});
}));
admin.post('/qr-codes/:id/revoke', csrf, asyncRoute(async (req,res) => {const r=await db.run("UPDATE qr_codes SET active=0,revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND active=1",[req.params.id]);if(!r.changes)return res.status(404).json({error:'Active code not found'});await db.run("UPDATE placements SET removed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE qr_code_id=? AND removed_at IS NULL",[req.params.id]);await audit(req.admin.id,'qr.revoke','qr_code',req.params.id);res.json({ok:true});}));
admin.get('/events', asyncRoute(async (req,res) => {const page=Math.max(1,Number(req.query.page)||1),limit=Math.min(100,Math.max(1,Number(req.query.limit)||25));const {clause,params}=eventFilters(req.query);const count=await db.get(`SELECT count(*) total,count(DISTINCT CASE WHEN e.source_ip!='unknown' THEN e.source_ip END) unique_source_ips FROM scan_events e JOIN qr_codes q ON q.id=e.qr_code_id ${clause}`,params);const rows=await db.all(`SELECT e.id,e.event_ref,e.campaign_id,e.qr_code_id,e.occurred_at,e.source_ip,e.classification,e.method,e.user_agent_category,e.processing_status,c.name campaign,q.reference code_reference,l.name location,COALESCE(NULLIF(q.label,''),p.team,'') placement,r.basis classification_basis,r.reviewed_at classification_reviewed_at FROM scan_events e JOIN campaigns c ON c.id=e.campaign_id JOIN qr_codes q ON q.id=e.qr_code_id JOIN locations l ON l.id=e.location_id LEFT JOIN placements p ON p.id=(SELECT p2.id FROM placements p2 WHERE p2.qr_code_id=q.id ORDER BY p2.created_at DESC LIMIT 1) LEFT JOIN event_classification_reviews r ON r.event_id=e.id ${clause} ORDER BY e.occurred_at DESC,e.id DESC LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit]);res.json({rows,total:count.total,uniqueSourceIps:count.unique_source_ips,page,limit});}));
admin.patch('/events/:id/classification', csrf, asyncRoute(async(req,res)=>{const s=z.object({classification:z.enum(['unclassified','likely_automated','possible_human','confirmed_human']),basis:string(1000).min(20)}).strict().safeParse(req.body);if(!s.success)return res.status(400).json({error:'Choose a classification and provide at least 20 characters describing the evidence basis'});if(s.data.classification==='confirmed_human'&&/^(ip address|user.?agent|javascript execution|shared location|device fingerprint)\.?$/i.test(s.data.basis.trim()))return res.status(400).json({error:'That evidence alone cannot support a confirmed human classification'});const event=await db.get('SELECT id,classification FROM scan_events WHERE id=?',[req.params.id]);if(!event)return res.sendStatus(404);await db.transaction(async()=>{await db.run('UPDATE scan_events SET classification=? WHERE id=?',[s.data.classification,event.id]);await db.run(`INSERT INTO event_classification_reviews(event_id,prior_classification,classification,basis,reviewed_by) VALUES(?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET prior_classification=excluded.prior_classification,classification=excluded.classification,basis=excluded.basis,reviewed_by=excluded.reviewed_by,reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,[event.id,event.classification,s.data.classification,s.data.basis,req.admin.id]);});await audit(req.admin.id,'event.classification.review','scan_event',event.id,{from:event.classification,to:s.data.classification});res.json({id:event.id,classification:s.data.classification,reviewed:true});}));
admin.get('/events.csv', asyncRoute(async (req,res)=>{const {clause,params}=eventFilters(req.query);const rows=await db.all(`SELECT e.qr_code_id,q.reference code_reference,c.name campaign,l.name location,COALESCE(NULLIF(q.label,''),p.team,'') placement,e.source_ip,e.occurred_at scanned_at_utc,e.classification,e.method,e.user_agent_category,e.processing_status FROM scan_events e JOIN campaigns c ON c.id=e.campaign_id JOIN qr_codes q ON q.id=e.qr_code_id JOIN locations l ON l.id=e.location_id LEFT JOIN placements p ON p.id=(SELECT p2.id FROM placements p2 WHERE p2.qr_code_id=q.id ORDER BY p2.created_at DESC LIMIT 1) ${clause} ORDER BY e.occurred_at DESC`,params);const esc=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};res.attachment('assessment-events.csv').type('text/csv').send(['qr_code_id,code_reference,campaign,location,placement,source_ip,scanned_at_utc,classification,method,user_agent_category,processing_status',...rows.map(r=>Object.values(r).map(esc).join(','))].join('\r\n'));await audit(req.admin.id,'events.export','scan_events',null,{rows:rows.length});}));
admin.get('/locations/analytics', asyncRoute(async (req,res)=>{const rows=await db.all(`SELECT l.id,l.name,count(DISTINCT CASE WHEN q.active=1 THEN q.id END) active_codes,count(e.id) total_requests,count(DISTINCT CASE WHEN e.classification IN ('possible_human','confirmed_human') THEN e.qr_code_id END) possible_unique_codes,sum(e.classification='confirmed_human') confirmed, min(e.occurred_at) first_event,max(e.occurred_at) last_event,max(p.placed_at) placed_at,max(p.removed_at) removed_at FROM locations l LEFT JOIN qr_codes q ON q.location_id=l.id LEFT JOIN scan_events e ON e.location_id=l.id LEFT JOIN placements p ON p.qr_code_id=q.id GROUP BY l.id ORDER BY l.name`);res.json(rows.map(r=>({...r,interaction_rate:percent(r.possible_unique_codes,r.active_codes)})));}));
admin.post('/reports/generate', csrf, asyncRoute(async(req,res)=>{const s=z.object({campaignId:z.number().int().positive()}).safeParse(req.body);if(!s.success)return res.status(400).json({error:'Campaign is required'});const campaign=await db.get('SELECT * FROM campaigns WHERE id=?',[s.data.campaignId]);if(!campaign)return res.sendStatus(404);const events=await db.all('SELECT qr_code_id,classification FROM scan_events WHERE campaign_id=?',[campaign.id]);const counts=await db.get('SELECT count(*) codes,count(DISTINCT location_id) locations FROM qr_codes WHERE campaign_id=?',[campaign.id]);const report=buildReport(campaign,events,counts.codes,counts.locations);report.locationRates=await db.all(`SELECT l.name location,count(DISTINCT q.id) codes,count(DISTINCT CASE WHEN e.classification IN ('possible_human','confirmed_human') THEN e.qr_code_id END) interaction_codes FROM locations l JOIN qr_codes q ON q.location_id=l.id LEFT JOIN scan_events e ON e.qr_code_id=q.id WHERE q.campaign_id=? GROUP BY l.id`,[campaign.id]);const x=await db.run('INSERT INTO assessment_reports(campaign_id,title,content_json,generated_by) VALUES(?,?,?,?)',[campaign.id,`${campaign.name} assessment report`,JSON.stringify(report),req.admin.id]);await audit(req.admin.id,'report.generate','assessment_report',x.lastID);res.status(201).json({id:x.lastID,...report});}));
admin.get('/reports', asyncRoute(async(req,res)=>res.json(await db.all('SELECT id,campaign_id,title,created_at FROM assessment_reports ORDER BY created_at DESC'))));
admin.get('/reports/:id', asyncRoute(async(req,res)=>{const r=await db.get('SELECT * FROM assessment_reports WHERE id=?',[req.params.id]);if(!r)return res.sendStatus(404);res.json({...r,content:JSON.parse(r.content_json)});}));
admin.get('/reports/:id/export.csv', asyncRoute(async(req,res)=>{const r=await db.get('SELECT * FROM assessment_reports WHERE id=?',[req.params.id]);if(!r)return res.sendStatus(404);const data=JSON.parse(r.content_json);const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};const rows=[['Metric','Value'],['Campaign',data.campaign],['Objective',data.objective],['Start date',data.duration.startsAt],['End date',data.duration.endsAt],['Active QR codes',data.activeQrCodes],['Approved locations',data.approvedLocations],['Total requests',data.totalRequests],['Estimated unique code interactions',data.estimatedUniqueInteractions],['Confirmed interactions',data.confirmedInteractions],['Potential automated traffic',data.potentialAutomatedTraffic],['Employee denominator available',data.denominatorAvailable],['Limitations',data.limitations],...data.followUpTopics.map((t,i)=>[`Suggested follow-up topic ${i+1}`,t]),...data.locationRates.map(x=>[x.location,x.interaction_codes,x.codes])];await audit(req.admin.id,'report.export','assessment_report',r.id,{format:'csv'});res.attachment(`assessment-report-${r.id}.csv`).type('text/csv').send(rows.map(row=>row.map(cell).join(',')).join('\r\n'));}));
admin.get('/audit-logs', asyncRoute(async(req,res)=>res.json(await db.all('SELECT a.*,ad.email administrator_email FROM audit_logs a LEFT JOIN administrators ad ON ad.id=a.administrator_id ORDER BY a.created_at DESC LIMIT 500'))));
admin.post('/participants/import', csrf, asyncRoute(async(req,res)=>{if(req.admin.role!=='privacy_admin')return res.status(403).json({error:'Privacy administrator role required'});const csv=String(req.body.csv||'');if(csv.length>1024*1024)return res.status(413).json({error:'CSV is too large'});let parsed;try{parsed=parseRoster(csv)}catch(e){return res.status(400).json({error:e.message})}const existing=await db.all(`SELECT email FROM participant_identity_mapping WHERE email COLLATE NOCASE IN (${parsed.map(()=>'?').join(',')})`,parsed.map(x=>x.email));if(existing.length)return res.status(409).json({error:'One or more email addresses already exist in the participant roster'});await db.transaction(async()=>{for(const p of parsed){const ref=uuid();const x=await db.run('INSERT INTO participant_records(participant_ref) VALUES(?)',[ref]);await db.run('INSERT INTO participant_identity_mapping(participant_id,email,display_name,imported_by) VALUES(?,?,?,?)',[x.lastID,p.email,p.name,req.admin.id]);}});await audit(req.admin.id,'participant_roster.import','participant_records',null,{count:parsed.length});res.status(201).json({imported:parsed.length});}));
admin.post('/attributions', csrf, asyncRoute(async(req,res)=>{if(req.admin.role!=='privacy_admin')return res.status(403).json({error:'Privacy administrator role required'});const s=z.object({eventId:z.number().int().positive(),participantRef:z.string().uuid(),basis:string(1000).min(1),confidence:z.enum(['low','medium','high'])}).safeParse(req.body);if(!s.success)return res.status(400).json({error:'Invalid attribution'});const person=await db.get('SELECT id FROM participant_records WHERE participant_ref=?',[s.data.participantRef]);if(!person)return res.sendStatus(404);const x=await db.run('INSERT INTO attribution_records(event_id,participant_id,basis,confidence,created_by) VALUES(?,?,?,?,?)',[s.data.eventId,person.id,s.data.basis,s.data.confidence,req.admin.id]);await audit(req.admin.id,'participant.attribution.create','attribution',x.lastID,{eventId:s.data.eventId});res.status(201).json({id:x.lastID});}));
admin.get('/participants', asyncRoute(async(req,res)=>{if(req.admin.role!=='privacy_admin')return res.status(403).json({error:'Privacy administrator role required'});await audit(req.admin.id,'participant_records.view','participant_records',null);res.json(await db.all('SELECT p.participant_ref,m.email,m.display_name,p.created_at FROM participant_records p JOIN participant_identity_mapping m ON m.participant_id=p.id WHERE p.active=1 ORDER BY p.created_at DESC'));}));
app.use('/api/admin', sameOrigin, admin);
app.get('/login', (req,res)=>res.sendFile(path.join(config.root,'public','login.html')));
app.get('/', (req,res)=>res.sendFile(path.join(config.root,'public','index.html')));
app.use((req,res)=>res.status(404).json({error:'Not found'}));
app.use((err,req,res,next)=>{console.error('Request failed');if(res.headersSent)return next(err);const status=Number.isInteger(err.status)&&err.status>=400&&err.status<500?err.status:500;res.status(status).json({error:status===400?'Invalid request body':'An unexpected error occurred'});});
module.exports=app;
