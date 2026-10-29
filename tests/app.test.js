const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-assessment-test-'));
process.env.NODE_ENV='test';process.env.DATABASE_PATH=path.join(temp,'test.sqlite');process.env.SESSION_SECRET='test-secret-value-with-enough-length-to-work';process.env.TRUST_PROXY_CIDRS='';process.env.DISPLAY_TIMEZONE='UTC';
const db=require('../src/database/db');const app=require('../src/app');
let server,base,cookie='',csrf='';
async function req(route,options={}){const headers={...(options.body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(options.method&&options.method!=='GET'?{'X-CSRF-Token':csrf}:{}),...options.headers};const r=await fetch(base+route,{...options,headers});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return r;}
async function json(r){return r.json()}
before(async()=>{for(const migration of fs.readdirSync(path.join(__dirname,'../src/database/migrations')).filter(x=>x.endsWith('.sql')).sort()){await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations',migration),'utf8'));await db.run('INSERT OR IGNORE INTO migrations(name) VALUES (?)',[migration])}const hash=await bcrypt.hash('test-password-that-is-long',4);await db.run('INSERT INTO administrators(email,password_hash,role) VALUES(?,?,?)',['admin@example.test',hash,'admin']);server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>db.raw.close(resolve));});

test('admin auth, campaign QR lifecycle, event handling, reporting, and public boundaries',async()=>{
  let r=await req('/api/admin/dashboard');assert.equal(r.status,401,'admin APIs require authentication');r=await req('/api/admin/events');assert.equal(r.status,401,'scan logs require admin authentication');
  r=await req('/api/admin/csrf');assert.equal(r.status,200);csrf=(await json(r)).csrfToken;assert.ok(cookie);
  r=await req('/api/admin/login',{method:'POST',body:JSON.stringify({email:'admin@example.test',password:'wrong-password'})});assert.equal(r.status,401);
  r=await req('/api/admin/login',{method:'POST',body:JSON.stringify({email:'admin@example.test',password:'test-password-that-is-long'})});assert.equal(r.status,200);const login=await json(r);csrf=login.csrfToken;assert.equal(login.admin.role,'admin');
  r=await req('/api/admin/me');assert.equal((await json(r)).timezone,'UTC');
  r=await fetch(base+'/api/admin/campaigns',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'Missing CSRF'})});assert.equal(r.status,403,'state-changing admin APIs require CSRF protection');
  r=await req('/api/admin/campaigns',{method:'POST',body:JSON.stringify({name:'Authorized test',objective:'Assess awareness',retentionDays:90})});assert.equal(r.status,201);const campaign=await json(r);
  r=await req('/api/admin/locations',{method:'POST',body:JSON.stringify({name:'Shared foyer',description:'Approved shared location'})});assert.equal(r.status,201);const location=await json(r);
  r=await req(`/api/admin/campaigns/${campaign.id}/activate`,{method:'POST',body:'{}'});assert.equal(r.status,200);
  r=await req('/api/admin/qr-codes/generate',{method:'POST',body:JSON.stringify({campaignId:campaign.id,locationIds:[location.id],countPerLocation:1,label:'Entrance'})});assert.equal(r.status,201);const code=(await json(r)).codes[0];assert.match(code.url,/\/q\/[A-Za-z0-9_-]{43}$/);assert.ok(code.qrDataUrl.startsWith('data:image/png;base64,'));
  r=await req('/api/admin/qr-codes/generate',{method:'POST',body:JSON.stringify({campaignId:campaign.id,locationIds:[location.id],countPerLocation:2,label:'Bulk test'})});assert.equal(r.status,201);const bulk=(await json(r)).codes;assert.equal(bulk.length,2);assert.equal(new Set(bulk.map(x=>x.url)).size,2);assert.ok(bulk.every(x=>x.url!==code.url&&x.qrDataUrl.startsWith('data:image/png;base64,')),'bulk QR URLs and generated PNGs are unique');
  const storedToken=decodeURIComponent(code.url.split('/q/')[1]);const persisted=await db.get('SELECT token_hash FROM qr_codes WHERE id=?',[code.id]);assert.notEqual(persisted.token_hash,storedToken,'only a token hash is persisted');
  const adminJs=fs.readFileSync(path.join(__dirname,'../public/js/app.js'),'utf8');assert.match(adminJs,/Download PNG/);assert.match(adminJs,/renderCodesWithoutPersistence/,'generated print sheet survives the inventory refresh');
  const fetches=await Promise.all(Array.from({length:6},()=>fetch(code.url)));assert.ok(fetches.every(x=>x.status===200),'valid active code serves landing page concurrently');const landingHtml=await fetches[0].text();assert.match(landingHtml,/Pause before you proceed/);assert.doesNotMatch(landingHtml,/QR-[A-Z0-9]+/,'public page does not expose internal code references');
  await fetch(code.url,{headers:{'X-Forwarded-For':'198.51.100.42'}}); // Forwarded values are ignored when proxy trust is disabled.
  await fetch(code.url,{headers:{'User-Agent':'Googlebot/2.1'}});
  app.set('trust proxy','loopback');const proxyStarted=Date.now();const proxied=await fetch(code.url,{headers:{'X-Forwarded-For':'2001:db8::25'}});const proxyFinished=Date.now();assert.equal(proxied.status,200);app.set('trust proxy',false);
  const scanStarted=Date.now();const landing=await fetch(code.url);const html=await landing.text();const scanFinished=Date.now();const eventRef=html.match(/name="eventRef" value="([^"]+)"/)[1];
  const continued=await fetch(code.url+'/continue',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`eventRef=${eventRef}`});assert.equal(continued.status,200);
  r=await req('/api/admin/events?page=1&limit=50');assert.equal(r.status,200);const events=await json(r);assert.equal(events.total,10);assert.equal(events.rows.filter(e=>e.classification==='possible_human').length,1);assert.equal(events.rows.filter(e=>e.classification==='likely_automated').length,1);assert.equal(events.rows.filter(e=>e.classification==='unclassified').length,8);
  const proxiedEvent=events.rows.find(e=>e.source_ip==='2001:db8::25');assert.ok(proxiedEvent,'trusted proxy forwarding captures IPv6 client IP');assert.equal(proxiedEvent.qr_code_id,code.id);assert.equal(proxiedEvent.campaign_id,campaign.id);assert.match(proxiedEvent.occurred_at,/\.\d{3}Z$/,'timestamp is stored as UTC ISO 8601 with millisecond precision');assert.ok(Date.parse(proxiedEvent.occurred_at)>=proxyStarted&&Date.parse(proxiedEvent.occurred_at)<=proxyFinished,'scan time is server-generated during the request');
  assert.ok(['127.0.0.1','::ffff:127.0.0.1'].includes(events.rows.find(e=>e.source_ip?.includes('127.0.0.1'))?.source_ip),'direct request records the socket peer address');assert.equal(events.rows.some(e=>e.source_ip==='198.51.100.42'),false,'untrusted X-Forwarded-For cannot spoof source IP');
  r=await req(`/api/admin/events?qrCode=${code.reference}&campaignId=${campaign.id}&sourceIp=2001%3Adb8%3A%3A25&from=${new Date().toISOString().slice(0,10)}&to=${new Date().toISOString().slice(0,10)}`);const filtered=await json(r);assert.equal(filtered.total,1);assert.equal(filtered.uniqueSourceIps,1);
  r=await req('/api/admin/events?sourceIp=198.51.100.42');assert.equal((await json(r)).total,0,'spoofed address is not searchable as the source');
  r=await req('/api/admin/dashboard');const dash=await json(r);assert.equal(dash.total_requests,10);assert.equal(dash.unique_source_ips,2);assert.equal(dash.unique_codes,1);
  r=await req(`/api/admin/events/${events.rows[0].id}/classification`,{method:'PATCH',body:JSON.stringify({classification:'confirmed_human',basis:'Separate verified participant confirmation recorded by the review team.'})});assert.equal(r.status,200);
  r=await req(`/api/admin/events/${events.rows[0].id}/classification`,{method:'PATCH',body:JSON.stringify({classification:'confirmed_human',basis:'IP address'})});assert.equal(r.status,400);
  r=await req('/api/admin/reports/generate',{method:'POST',body:JSON.stringify({campaignId:campaign.id})});assert.equal(r.status,201);const report=await json(r);assert.equal(report.estimatedUniqueInteractions,1);assert.equal(report.confirmedInteractions,1);assert.equal(report.denominatorAvailable,false);
  r=await req(`/api/admin/reports/${report.id}/export.csv`);assert.equal(r.status,200);assert.match(await r.text(),/Limitations/);
  r=await req('/api/admin/participants');assert.equal(r.status,403,'identity mapping is role-restricted');
  await db.run("UPDATE administrators SET role='privacy_admin' WHERE email='admin@example.test'");
  r=await req('/api/admin/participants/import',{method:'POST',body:JSON.stringify({csv:'name,email\n"Example, Person",person@example.test'})});assert.equal(r.status,201);assert.equal((await json(r)).imported,1);
  r=await req('/api/admin/participants');assert.equal(r.status,200);const roster=await json(r);assert.equal(roster[0].display_name,'Example, Person');
  r=await req('/api/admin/attributions',{method:'POST',body:JSON.stringify({eventId:events.rows[0].id,participantRef:roster[0].participant_ref,basis:'Approved separate follow-up',confidence:'medium'})});assert.equal(r.status,201);
  await db.run("UPDATE administrators SET role='admin' WHERE email='admin@example.test'");
  r=await req('/api/admin/events.csv');assert.equal(r.status,200);const eventCsv=await r.text();assert.match(eventCsv,/qr_code_id,code_reference,campaign,location,placement,source_ip,scanned_at_utc/);assert.match(eventCsv,/2001:db8::25/);
  r=await req(`/api/admin/qr-codes/${code.id}/revoke`,{method:'POST',body:'{}'});assert.equal(r.status,200);
  const revoked=await fetch(code.url);assert.equal(revoked.status,404,'revoked token is immediately unavailable');
  const wrongOrigin=await req('/api/admin/campaigns',{method:'POST',headers:{Origin:'https://evil.invalid'},body:JSON.stringify({name:'Blocked'})});assert.equal(wrongOrigin.status,403);
  const beforeInvalid=await db.get('SELECT count(*) n FROM scan_events');const invalidToken=await fetch(base+'/q/not-a-valid-token');assert.equal(invalidToken.status,404);const afterInvalid=await db.get('SELECT count(*) n FROM scan_events');assert.equal(afterInvalid.n,beforeInvalid.n,'invalid and revoked tokens do not create scan events');
});
