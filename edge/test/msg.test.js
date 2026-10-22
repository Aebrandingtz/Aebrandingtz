/* Tests the SMS worker against a fake NextSMS and a fake (in-memory) database. Run: node test/msg.test.js
   The database rules themselves (credits, limits, consent...) are tested in SQL (see MESSAGING_TESTS.sql); this file tests what the Node side decides. */
'use strict';
const http = require('http'), path = require('path');
let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };
const ROOT = path.join(__dirname, '..', 'api');
const AUTH = 'Bearer ntoken-123';

/* ---------- fake database ---------- */
const DB = { settings: { sending_mode: 'live', blocked_until: null }, recs: [], state: [], failRecord: false, admins: ['admin-1'], senders: null };
const mk = (n, phone, extra) => DB.recs.push(Object.assign({ id: 'r' + n + '-' + '0'.repeat(8), campaign_id: 'c1', phone, body: 'Habari ' + n, sender: 'SHEREHE', status: 'pending', attempts: 0, request_id: null, error_code: null, events: [] }, extra || {}));
const dbRpc = {
  msg_w_config: () => ({ mode: DB.settings.sending_mode, blocked_until: DB.settings.blocked_until, batch: 100, concurrency: 3, pending: DB.recs.filter(r => r.status === 'pending').length, dlr_due: DB.recs.filter(r => r.status === 'submitted' && !r.dlr_done).length }),
  msg_w_claim: a => { if (DB.settings.sending_mode === 'off' || DB.settings.blocked_until) return []; const out = []; for (const r of DB.recs) { if (out.length >= a.p_limit) break; if (r.status === 'pending' && (!r.next || r.next <= Date.now())) { r.status = 'sending'; r.attempts++; out.push({ id: r.id, campaign_id: r.campaign_id, phone: r.phone, body: r.body, attempts: r.attempts, sender: r.sender }); } } return out; },
  msg_w_record: a => { if (DB.failRecord) throw new Error('db down'); const r = DB.recs.find(x => x.id === a.p_id); if (!r || r.status !== 'sending') return { ok: true, ignored: true };
    r.error_code = a.p_code; r.error_text = a.p_text; r.last = a;
    if (a.p_outcome === 'submitted') { r.status = 'submitted'; r.request_id = a.p_request_id; } else if (a.p_outcome === 'retry' && r.attempts < 5) { r.status = 'pending'; r.next = Date.now() + (a.p_retry_s || 30) * 1000; } else if (a.p_outcome === 'blocked') { r.status = 'pending'; r.attempts--; DB.settings.blocked_until = 'later'; }
    else if (a.p_outcome === 'unknown') r.status = 'unknown'; else r.status = 'failed'; return { ok: true }; },
  msg_w_dlr_due: () => DB.recs.filter(r => r.status === 'submitted' && !r.dlr_done).map(r => { r.dlr_done = true; return { id: r.id, request_id: r.request_id, phone: r.phone }; }),
  msg_w_dlr_apply: a => { const r = DB.recs.find(x => x.id === a.p_id); if (a.p_status === 'delivered') r.status = 'delivered'; else if (a.p_status === 'failed') { r.status = 'failed'; r.error_code = 'dlr_failed'; } return { ok: true }; },
  msg_w_provider_state: a => { DB.settings.blocked_until = a.p_blocked_until; DB.state.push(a); return { ok: true }; },
  msg_w_sender_sync: a => { DB.senders = a.p_items; return { ok: true, synced: a.p_items.length }; }
};

/* ---------- fake NextSMS ---------- */
const BM = { sends: [], dlrs: [], mode: {}, delayMs: 0, balance: 49121 };
const BIG = '6342623755839986228';           // 19 digits: JSON.parse would round it
function readBody(req) { return new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => r(b)); }); }
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), body = await readBody(req); const j = (s, o, h) => { res.writeHead(s, Object.assign({ 'content-type': 'application/json' }, h || {})); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
  if (u.pathname.startsWith('/rest/v1/rpc/')) { const fn = u.pathname.split('/').pop(), f = dbRpc[fn]; if (!f) return j(404, {}); try { return j(200, f(JSON.parse(body || '{}'))); } catch (e) { return j(500, { message: String(e) }); } }
  if (u.pathname === '/auth/v1/user') { const t = (req.headers.authorization || '').replace('Bearer ', ''); if (t === 'eyJuser') return j(200, { id: 'user-1', email: 'u@x.co' }); if (t === 'eyJadmin') return j(200, { id: 'admin-1', email: 'a@x.co' }); return j(401, {}); }
  if (u.pathname === '/rest/v1/profiles') { const id = (u.searchParams.get('id') || '').replace('eq.', ''); return j(200, DB.admins.includes(id) ? [{ role: 'admin' }] : [{ role: 'user' }]); }
  if (req.headers.authorization !== AUTH) { return j(401, { message: 'Unauthorized' }); }
  const st = (groupId, groupName, id, name) => ({ groupId, groupName, id, name });
  if (u.pathname === '/api/sms/v2/text/single' || u.pathname === '/api/sms/v2/test/text/single') {
    const b = JSON.parse(body); BM.sends.push({ b, auth: req.headers.authorization, path: u.pathname }); const ph = b.to, tail = ph.slice(-3);
    if (BM.delayMs && tail === '999') await new Promise(r => setTimeout(r, BM.delayMs));
    const one = (status, extra) => '{"messages":[{"to":"' + ph + '","status":' + JSON.stringify(status) + ',"messageId":' + BIG.slice(0, 15) + ph.slice(-4) + ',"smsCount":1,"price":16' + (extra || '') + '}]}';
    const no = status => '{"messages":[{"to":"' + ph + '","status":' + JSON.stringify(status) + ',"smsCount":1}]}';
    switch (tail) {
      case '101': return j(200, no(st(19, 'REJECTED', 69, 'REJECTED_INVALID_DESTINATION')));
      case '102': return j(200, no(st(22, 'FAILED', 57, 'NOT_ENOUGH_CREDITS')));
      case '103': return j(200, no(st(19, 'REJECTED', 63, 'REJECTED_FLOODING_FILTER')));
      case '104': return j(200, no(st(19, 'REJECTED', 64, 'REJECTED_SYSTEM_ERROR')));
      case '110': return j(200, no(st(19, 'REJECTED', 67, 'REJECTED_MESSAGE_TOO_LONG')));
      case '111': return j(200, no(st(19, 'REJECTED', 56, 'REJECTED_SOURCE')));
      case '112': return j(200, no(st(19, 'REJECTED', 55, 'REJECTED_DND')));
      case '113': return j(200, no(st(19, 'REJECTED', 65, 'REJECTED_DUPLICATE')));
      case '120': return j(401, { message: 'Unauthorized' });
      case '429': return j(429, { message: 'slow down' }, { 'retry-after': '12' });
      case '500': return j(500, 'oops');
      case '777': return j(200, 'not json at all');
      case '778': return j(200, no(st(18, 'PENDING', 51, 'ENROUTE (SENT)')));
      case '779': return j(200, one(st(20, 'DELIVERY', 76, 'UNDELIVERABLE')));
      case '780': return j(200, one(st(20, 'DELIVERY', 73, 'DELIVERED')));
      case '781': return j(400, { error: 'bad request' });
      default: return j(200, one(st(18, 'PENDING', 51, 'ENROUTE (SENT)')));
    }
  }
  if (u.pathname === '/api/v2/balance') return j(200, { sms_balance: BM.balance, over_draft: 0, type: 'price', default_balance: 3070, default: 'Internet Channel', display: '49,121.00 TZS' });
  if (u.pathname === '/api/v2/reports') {
    const rid = u.searchParams.get('messageId'); BM.dlrs.push({ rid }); const s = BM.mode[rid];
    if (s === '404') return j(404, { message: 'none' }); if (s === '401') return j(401, { message: 'Unauthorized' }); if (s === 'EMPTY') return j(200, { results: [] }); if (s === 'BAD') return j(200, { nope: 1 });
    const map = { DELIVERED: st(20, 'DELIVERY', 73, 'DELIVERED'), UNDELIVERED: st(20, 'DELIVERY', 76, 'UNDELIVERABLE'), EXPIRED: st(20, 'DELIVERY', 74, 'EXPIRED'), READ: st(20, 'DELIVERY', 108, 'READ'), PENDING: st(18, 'PENDING', 51, 'ENROUTE (SENT)'), UNKNOWN: st(20, 'DELIVERY', 78, 'UNKNOWN') };
    return j(200, '{"results":[{"messageId":"' + rid + '","to":"255712345000","status":' + JSON.stringify(map[s || 'PENDING']) + ',"delivery":"' + (s || 'PENDING') + '"}]}');
  }
  j(404, {});
});
const mkRes = () => { const r = { code: 0, headers: {}, body: '' }; r.setHeader = (k, v) => r.headers[k.toLowerCase()] = v; r.end = b => { r.body = b || ''; }; Object.defineProperty(r, 'statusCode', { set(v) { r.code = v; }, get() { return r.code; } }); return r; };
const call = async (mod, req) => { const r = mkRes(); req.headers = Object.assign({}, req.headers || {}); await require(path.join(ROOT, mod))(req, r); let json = null; try { json = JSON.parse(r.body); } catch (e) {} return { r, json }; };
const reset = () => { DB.recs.length = 0; DB.state.length = 0; DB.settings.blocked_until = null; DB.settings.sending_mode = 'live'; DB.failRecord = false; BM.sends.length = 0; BM.dlrs.length = 0; BM.mode = {}; BM.delayMs = 0; };

(async () => {
  await new Promise(r => server.listen(0, r)); const base = 'http://127.0.0.1:' + server.address().port;
  const M = require(path.join(ROOT, '_lib/msg.js'));

  /* --- classification of NextSMS answers (pure) --- */
  const C = M.classify, R = (id, g, name, extra) => JSON.stringify({ messages: [Object.assign({ to: '255712345000', status: { groupId: g, groupName: 'X', id, name: name || 'N' }, smsCount: 1, price: 16 }, extra || {})] });
  const withId = (id, g) => R(id, g, 'N', {}).replace('"smsCount"', '"messageId":' + BIG + ',"smsCount"');   // messageId as a raw 19-digit number
  let c1 = C(200, withId(51, 18));
  ok(c1.outcome === 'submitted' && c1.requestId === BIG, '18/51 ENROUTE + messageId -> submitted, 19-digit id kept exactly (' + c1.requestId + ')');
  ok(C(200, withId(50, 18)).outcome === 'submitted' && C(200, withId(52, 18)).outcome === 'submitted' && C(200, withId(88, 18)).outcome === 'submitted', 'ACCEPTED / DISPATCHED / WAITING_DELIVERY -> submitted');
  ok(C(200, withId(109, 20)).outcome === 'submitted' && C(200, withId(73, 20)).outcome === 'submitted', 'SENT / DELIVERED on send -> submitted (delivery still confirmed by the report)');
  ok(C(200, R(51, 18)).outcome === 'unknown' && C(200, R(51, 18)).code === 'no_message_id', 'accepted without messageId -> unknown (never "sent" on a guess)');
  ok(C(200, R(69, 19)).outcome === 'failed' && C(200, R(54, 19)).outcome === 'failed' && C(200, R(55, 19)).outcome === 'failed', 'invalid number / prefix / DND -> failed');
  ok(C(200, R(67, 19)).outcome === 'failed' && C(200, R(66, 19)).outcome === 'failed' && C(200, R(59, 19)).outcome === 'failed', 'too long / bad UDH / blacklisted -> failed');
  ok(C(200, R(76, 20)).outcome === 'failed' && C(200, R(79, 20)).outcome === 'failed', 'UNDELIVERABLE / REJECTED -> failed');
  ok(['56', '57', '60', '61', '62'].every(i => C(200, R(Number(i), 19)).outcome === 'blocked') && C(200, R(57, 22)).outcome === 'blocked' && C(200, R(58, 22)).outcome === 'blocked', 'sender not registered / no credits / expired / test-only / no route -> blocked (messages wait)');
  ok(C(200, R(63, 19)).outcome === 'retry' && C(200, R(63, 19)).retryS >= 600 && C(200, R(64, 19)).outcome === 'retry' && C(200, R(110, 19)).outcome === 'retry', 'flooding filter / system error / limit -> retry later');
  ok(C(200, R(65, 19)).outcome === 'unknown' && C(200, R(78, 20)).outcome === 'unknown', 'duplicate id / UNKNOWN -> unknown (never auto re-sent)');
  ok(C(401, { message: 'Unauthorized' }).outcome === 'blocked' && C(403, '').outcome === 'blocked', 'HTTP 401/403 -> blocked (stop sending, do not fail the messages)');
  ok(C(429, null, '12').outcome === 'retry' && C(429, null, '12').retryS === 12, '429 -> retry with Retry-After');
  ok(C(502, null).outcome === 'unknown' && C(500, 'x').outcome === 'unknown', '5xx -> unknown (may have been sent)');
  ok(C(200, 'not json').outcome === 'unknown' && C(200, null).outcome === 'unknown', 'unreadable 200 answer -> unknown');
  ok(C(400, { error: 'bad request' }).outcome === 'blocked', 'unexpected 4xx -> blocked (systematic problem, do not fail every message)');
  ok(C(200, R(999, 19)).outcome === 'failed' && C(200, R(999, 7)).outcome === 'unknown', 'unlisted rejection id -> failed; completely unknown status -> unknown');
  ok(M.parseJson('{"messageId":6342623755839986228}').messageId === BIG && M.parseJson('{"a":1}').a === 1 && M.parseJson('x') === null, 'parseJson keeps 19-digit ids as text');

  /* --- guards --- */
  ['SUPABASE_SERVICE_ROLE_KEY', 'NEXTSMS_API_TOKEN', 'NEXTSMS_USERNAME', 'NEXTSMS_PASSWORD', 'NEXTSMS_ENV', 'MSG_CRON_SECRET'].forEach(k => delete process.env[k]);
  let x = await call('msg/run.js', { method: 'POST', body: {} }); ok(x.r.code === 503, 'run without database key -> 503');
  Object.assign(process.env, { SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'srv', MSG_CRON_SECRET: 'cron-secret-123456', NEXTSMS_BASE_URL: base, MSG_HTTP_TIMEOUT_MS: '700', VERCEL_ENV: 'production', MSG_PROVIDER: 'mock' });
  x = await call('msg/run.js', { method: 'GET' }); ok(x.r.code === 405, 'run only accepts POST');
  x = await call('msg/run.js', { method: 'POST', body: {} }); ok(x.r.code === 401, 'run without credentials -> 401');
  x = await call('msg/run.js', { method: 'POST', body: {}, headers: { authorization: 'Bearer wrong-secret-xxxxxx' } }); ok(x.r.code === 401, 'run with a wrong secret -> 401');
  x = await call('msg/run.js', { method: 'POST', body: {}, headers: { authorization: 'Bearer eyJbogus' } }); ok(x.r.code === 401, 'run with an invalid user token -> 401');
  ok(M.env().mock === false, 'the mock provider is ignored when VERCEL_ENV=production');

  /* --- provider not configured: nothing is claimed --- */
  const CRON = { authorization: 'Bearer cron-secret-123456' };
  reset(); mk(1, '255712345001');
  x = await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  ok(x.r.code === 200 && x.json.stats.note === 'provider_not_configured' && DB.recs[0].status === 'pending' && BM.sends.length === 0, 'NextSMS token missing -> nothing claimed, nothing sent');

  Object.assign(process.env, { NEXTSMS_API_TOKEN: 'ntoken-123' });
  /* --- sending mode off --- */
  reset(); DB.settings.sending_mode = 'off'; mk(1, '255712345001');
  x = await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  ok(x.json.stats.note === 'sending_off' && BM.sends.length === 0 && DB.recs[0].status === 'pending', 'sending mode off -> no SMS leaves the server');

  /* --- normal run with every kind of answer --- */
  reset();
  const phones = ['255712345001', '255712345101', '255712345104', '255712345110', '255712345500', '255712345777', '255712345778', '255712345779', '255712345113', '255712345112', '255712345002'];
  phones.forEach((p, i) => mk(i, p));
  x = await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  const S = p => DB.recs.find(r => r.phone === p);
  ok(x.r.code === 200 && x.json.who === 'cron', 'cron run accepted');
  ok(S('255712345001').status === 'submitted' && /^\d{19}$/.test(S('255712345001').request_id) && S('255712345001').request_id.endsWith('5001'), 'normal message -> submitted with the 19-digit NextSMS messageId, unrounded (' + S('255712345001').request_id + ')');
  ok(BM.sends.every(s => s.auth === AUTH && s.path === '/api/sms/v2/text/single'), 'every request used Bearer auth on the live endpoint');
  const b0 = BM.sends[0].b; ok(b0.from === 'SHEREHE' && b0.flash === 0 && typeof b0.to === 'string' && /^255\d{9}$/.test(b0.to) && b0.text.startsWith('Habari') && /^[0-9a-z]{1,20}$/.test(b0.reference), 'request body matches NextSMS docs (from, to, text, flash 0, short reference)');
  ok(S('255712345101').status === 'failed' && S('255712345101').error_code === '69', 'invalid destination -> failed with provider code 69');
  ok(S('255712345110').status === 'failed' && S('255712345112').status === 'failed', 'too long / DND -> failed');
  ok(S('255712345104').status === 'pending' && S('255712345104').last.p_outcome === 'retry', 'system error 64 -> back to pending');
  ok(S('255712345113').status === 'unknown', 'duplicate -> unknown');
  ok(S('255712345500').status === 'unknown', '500 -> unknown (not retried blindly)');
  ok(S('255712345777').status === 'unknown', 'garbage answer -> unknown');
  ok(S('255712345778').status === 'unknown', 'success without messageId -> unknown');
  ok(S('255712345779').status === 'failed', 'UNDELIVERABLE on send -> failed');
  ok(BM.sends.filter(s => s.b.to === '255712345113').length === 1, 'an unknown message is sent exactly once');

  reset(); mk(1, '255712345111'); mk(2, '255712345009'); await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  ok(DB.settings.blocked_until === 'later' && DB.recs[0].status === 'pending' && DB.recs[0].last.p_code === '56', 'sender ID not registered (56) blocks sending; message waits');
  reset(); mk(1, '255712345102'); mk(2, '255712345009'); await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  ok(DB.settings.blocked_until === 'later' && DB.recs[0].status === 'pending' && DB.recs[0].last.p_code === '57', 'no provider credits (57) blocks sending, message waits (not failed)');

  /* --- 401 stops everything --- */
  reset(); ['255712345120', '255712345003', '255712345004', '255712345005', '255712345006', '255712345007'].forEach((p, i) => mk(i, p));
  x = await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  ok(DB.settings.blocked_until === 'later' && BM.sends.length <= 3, 'auth failure blocks the provider and stops claiming more (sent ' + BM.sends.length + ')');
  ok(DB.recs.filter(r => r.status === 'failed').length === 0, 'auth failure does not fail the messages');
  x = await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  ok(x.json.stats.note === 'provider_blocked' && BM.sends.length <= 3, 'next run respects the block');

  /* --- 429 retry --- */
  reset(); mk(1, '255712345429'); await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  ok(DB.recs[0].status === 'pending' && DB.recs[0].last.p_outcome === 'retry' && DB.recs[0].last.p_retry_s === 12, '429 -> back to pending with the provider retry delay');

  /* --- timeout becomes unknown, never re-sent --- */
  reset(); BM.delayMs = 1500; mk(1, '255712345999');
  x = await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  ok(DB.recs[0].status === 'unknown' && DB.recs[0].error_code === 'timeout', 'no answer within the timeout -> unknown');
  await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  ok(BM.sends.length === 1, 'and it is not sent again');

  /* --- database fails after NextSMS accepted: message must not be re-sent --- */
  reset(); mk(1, '255712345008'); DB.failRecord = true;
  await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  ok(DB.recs[0].status === 'sending' && BM.sends.length === 1, 'result could not be saved -> stays "sending" (database later marks it unknown)');
  DB.failRecord = false; await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  ok(BM.sends.length === 1, 'a "sending" message is never claimed again');

  /* --- test mode: the /test/ endpoint is used --- */
  process.env.NEXTSMS_ENV = 'test'; reset(); mk(1, '255712345050'); await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  ok(BM.sends.length === 1 && BM.sends[0].path === '/api/sms/v2/test/text/single', 'NEXTSMS_ENV=test uses the free test endpoint');
  delete process.env.NEXTSMS_ENV;

  /* --- Basic auth fallback --- */
  const tok = process.env.NEXTSMS_API_TOKEN; delete process.env.NEXTSMS_API_TOKEN; Object.assign(process.env, { NEXTSMS_USERNAME: 'u', NEXTSMS_PASSWORD: 'p' });
  ok(M.authHeader(M.env()) === 'Basic ' + Buffer.from('u:p').toString('base64') && M.providerConfigured(), 'username + password work as a fallback (Basic)');
  delete process.env.NEXTSMS_USERNAME; delete process.env.NEXTSMS_PASSWORD; process.env.NEXTSMS_API_TOKEN = tok;

  /* --- delivery reports --- */
  reset(); ['255712345010', '255712345011', '255712345012', '255712345013', '255712345014', '255712345015', '255712345016', '255712345017', '255712345018'].forEach((p, i) => mk(i, p));
  await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  const rid = p => S(p).request_id;
  BM.mode = { [rid('255712345010')]: 'DELIVERED', [rid('255712345011')]: 'UNDELIVERED', [rid('255712345012')]: 'PENDING', [rid('255712345013')]: '404', [rid('255712345014')]: 'EMPTY', [rid('255712345015')]: 'READ', [rid('255712345016')]: 'EXPIRED', [rid('255712345017')]: 'UNKNOWN', [rid('255712345018')]: 'BAD' };
  DB.recs.forEach(r => { r.dlr_done = false; });
  x = await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  const D = p => DB.recs.find(r => r.phone === p).status;
  ok(D('255712345010') === 'delivered' && D('255712345015') === 'delivered', 'DELIVERED / READ -> delivered');
  ok(D('255712345011') === 'failed' && D('255712345016') === 'failed', 'UNDELIVERABLE / EXPIRED -> failed');
  ok(['255712345012', '255712345013', '255712345014', '255712345017', '255712345018'].every(p => D(p) === 'submitted'), 'PENDING / 404 / empty / UNKNOWN / unreadable -> stays submitted');
  ok(BM.dlrs.length === 9 && BM.dlrs.every(d => /^\d{19}$/.test(d.rid)), 'delivery report asked with the exact 19-digit messageId');
  reset(); mk(1, '255712345020'); await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  BM.mode = { [rid('255712345020')]: '401' }; DB.recs[0].dlr_done = false; await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  ok(DB.state.length === 1 && /401/.test(DB.state[0].p_reason), 'delivery report auth failure blocks the provider');

  /* --- user "kick" --- */
  reset(); mk(1, '255712345030');
  x = await call('msg/run.js', { method: 'POST', body: {}, headers: { authorization: 'Bearer eyJuser' } });
  ok(x.r.code === 200 && x.json.who === 'user' && DB.recs[0].status === 'submitted', 'a logged-in user can start the worker for their own queue');
  mk(2, '255712345031'); x = await call('msg/run.js', { method: 'POST', body: {}, headers: { authorization: 'Bearer eyJuser' } });
  ok(x.json.skipped === 'recent', 'user kicks are throttled');

  /* --- provider endpoint (admin) --- */
  x = await call('msg/provider.js', { method: 'POST', body: { action: 'status' }, headers: { authorization: 'Bearer eyJuser' } }); ok(x.r.code === 403, 'provider status refused for a normal user');
  x = await call('msg/provider.js', { method: 'POST', body: { action: 'status' } }); ok(x.r.code === 403, 'provider status refused without login');
  x = await call('msg/provider.js', { method: 'POST', body: { action: 'status' }, headers: { authorization: 'Bearer eyJadmin' } });
  ok(x.r.code === 200 && x.json.configured && x.json.provider === 'nextsms' && x.json.balance === 49121 && x.json.balance_unit === 'TZS' && x.json.balance_display === '49,121.00 TZS' && x.json.auth === 'ok' && x.json.environment === 'live', 'admin sees NextSMS balance in TZS');
  ok(!JSON.stringify(x.json).includes('ntoken-123'), 'no secret appears in the response');
  x = await call('msg/provider.js', { method: 'POST', body: { action: 'sync_senders' }, headers: { authorization: 'Bearer eyJadmin' } });
  ok(x.json.synced === null && /by hand/.test(x.json.note) && DB.senders === null, 'sync_senders is not supported: explains, changes nothing');
  process.env.NEXTSMS_API_TOKEN = 'wrong'; x = await call('msg/provider.js', { method: 'POST', body: { action: 'status' }, headers: { authorization: 'Bearer eyJadmin' } });
  ok(x.json.auth === 'rejected', 'a wrong token is reported as rejected');
  delete process.env.NEXTSMS_API_TOKEN; x = await call('msg/provider.js', { method: 'POST', body: { action: 'status' }, headers: { authorization: 'Bearer eyJadmin' } });
  ok(x.json.configured === false && /NEXTSMS_API_TOKEN/.test(x.json.note), 'missing token is reported without calling the provider');

  /* --- mock provider (outside production only) --- */
  Object.assign(process.env, { VERCEL_ENV: 'preview' }); delete process.env.NEXTSMS_API_TOKEN; reset(); M.resetMock();
  mk(1, '255712345040'); mk(2, '255712345000'); mk(3, '255712345111'); mk(4, '255712345222');
  await call('msg/run.js', { method: 'POST', body: {}, headers: CRON });
  ok(M.env().mock && M.mockLog().length >= 4 && BM.sends.length === 0, 'mock provider sends nothing over the network');
  ok(S('255712345040').status === 'submitted' && S('255712345000').status === 'failed' && S('255712345111').status === 'unknown', 'mock outcomes follow the phone suffix');

  console.log('\n' + pass + ' passed, ' + fail + ' failed'); server.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
