/* SHEREHE HUB bulk SMS: shared helpers (NextSMS adapter + queue worker).
   Secrets come only from environment variables: NEXTSMS_API_TOKEN (or NEXTSMS_USERNAME + NEXTSMS_PASSWORD), SUPABASE_SERVICE_ROLE_KEY, MSG_CRON_SECRET.
   Endpoints and status codes are taken from NextSMS's own "Messaging Service API V2" documentation:
     POST {base}/api/sms/v2/text/single       body {from, to, text, flash:0, reference}   (test URL: /api/sms/v2/test/text/single, nothing is sent)
          -> { messages: [ { to, status: { groupId, groupName, id, name }, messageId, smsCount, price } ] }
     GET  {base}/api/v2/reports?messageId=    -> { results: [ { messageId, status: { groupId, groupName, id, name }, delivery, ... } ] }
     GET  {base}/api/v2/balance               -> { sms_balance, over_draft, type, display }
   base = https://messaging-service.co.tz. Auth: "Authorization: Bearer <token>" (recommended) or Basic username:password.
   A message is never marked "sent" on a guess: only a PENDING/ENROUTE-type status WITH a messageId counts as "submitted to the operator";
   "delivered" only comes from a delivery report. Anything unclear (timeouts, 5xx, unreadable answers, duplicate ids) becomes "unknown" and is NEVER re-sent automatically.
   messageId is a 19-digit number: it is read as TEXT (JSON.parse would round it). */
'use strict';
const crypto = require('crypto');
const DEFAULT_SB = 'https://ajxybsfhckdxzslpsnjb.supabase.co';

function env() {
  const test = process.env.NEXTSMS_ENV === 'test';
  const mock = process.env.MSG_PROVIDER === 'mock' && process.env.VERCEL_ENV !== 'production'; // the mock can never run in production
  return {
    mock, test,
    token: process.env.NEXTSMS_API_TOKEN, user: process.env.NEXTSMS_USERNAME, pass: process.env.NEXTSMS_PASSWORD,
    base: (process.env.NEXTSMS_BASE_URL || 'https://messaging-service.co.tz').replace(/\/+$/, ''),
    sb: process.env.SUPABASE_URL || DEFAULT_SB, sbKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    cron: process.env.MSG_CRON_SECRET,
    timeout: Number(process.env.MSG_HTTP_TIMEOUT_MS) || 8000,
    budget: Number(process.env.MSG_RUN_BUDGET_MS) || 40000
  };
}
const dbConfigured = () => !!env().sbKey;
const hasCreds = c => !!(c.token || (c.user && c.pass));
const providerConfigured = () => { const c = env(); return c.mock || hasCreds(c); };

async function rpc(fn, args) {
  const c = env();
  const h = { apikey: c.sbKey, 'Content-Type': 'application/json' };
  if (/^eyJ/.test(c.sbKey || '')) h.Authorization = 'Bearer ' + c.sbKey;
  const r = await fetch(c.sb + '/rest/v1/rpc/' + fn, { method: 'POST', headers: h, body: JSON.stringify(args || {}) });
  const t = await r.text();
  if (!r.ok) throw new Error('db ' + fn + ' ' + r.status);
  try { return JSON.parse(t); } catch (e) { return t; }
}

/* who is calling with a user token (verified by Supabase Auth, never trusted from the browser) */
async function userOf(req) {
  const c = env(), a = String(req.headers.authorization || '');
  const m = /^Bearer\s+(eyJ[A-Za-z0-9._-]+)$/.exec(a);
  if (!m || !c.sbKey) return null;
  try {
    const r = await fetch(c.sb + '/auth/v1/user', { headers: { apikey: c.sbKey, Authorization: 'Bearer ' + m[1] } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? { id: u.id, email: u.email || null } : null;
  } catch (e) { return null; }
}
async function isAdmin(uid) {
  const c = env();
  try {
    const h = { apikey: c.sbKey }; if (/^eyJ/.test(c.sbKey || '')) h.Authorization = 'Bearer ' + c.sbKey;
    const r = await fetch(c.sb + '/rest/v1/profiles?select=role&id=eq.' + encodeURIComponent(uid), { headers: h });
    const j = await r.json();
    return Array.isArray(j) && j[0] && j[0].role === 'admin';
  } catch (e) { return false; }
}
function cronOk(req) {
  const c = env(); if (!c.cron || c.cron.length < 16) return false;
  const m = /^Bearer\s+(.+)$/.exec(String(req.headers.authorization || '')); if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(c.cron);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const authHeader = c => c.token ? 'Bearer ' + c.token : 'Basic ' + Buffer.from(c.user + ':' + c.pass).toString('base64');
async function http(url, opt, ms) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, Object.assign({}, opt, { signal: ac.signal })); } finally { clearTimeout(t); }
}
/* read the provider's JSON; the 19-digit messageId is turned into text first so it is not rounded */
function parseJson(t) {
  if (t && typeof t === 'object') return t;
  if (typeof t !== 'string') return null;
  try { return JSON.parse(t.replace(/("messageId"\s*:\s*)(\d{12,})/g, '$1"$2"')); } catch (e) { return null; }
}

/* NextSMS status ids (documentation, "Response status and error codes") */
const ST_OK = { 50: 1, 51: 1, 52: 1, 88: 1, 73: 1, 77: 1, 108: 1, 109: 1 };                       // accepted / on its way / already delivered
const ST_BLOCK = { 56: 'sender_not_registered', 57: 'not_enough_credits', 58: 'sender_not_registered_on_network', 60: 'credits_expired', 61: 'account_test_only', 62: 'no_route', 111: 'missing_outlet' };
const ST_FAIL = { 53: 'network_not_available', 54: 'invalid_number', 55: 'dnd', 59: 'destination_blocked', 66: 'bad_message', 67: 'message_too_long', 68: 'missing_to', 69: 'invalid_number', 74: 'expired', 75: 'deleted', 76: 'undeliverable', 79: 'rejected', 80: 'skipped' };
const ST_RETRY = { 63: 900, 64: 60, 110: 600 };                                                  // flooding filter, system error, message limit
const ST_UNKNOWN = { 65: 'duplicate_message_id', 78: 'unknown' };
const BLOCK_TEXT = { 56: 'Sender ID is not registered on the provider account', 57: 'Provider account is out of credits', 58: 'Sender ID is not registered on the network', 60: 'Provider credits have expired', 61: 'Provider account only allows a test number', 62: 'Provider account has no route set up', 111: 'Provider account has no active outlet' };

/* Turn NextSMS's answer into one of our outcomes. Pure function (tested).
   outcome: submitted | retry | blocked | failed | unknown */
function classify(status, body, retryAfter) {
  const j = parseJson(body);
  const msg = j && typeof j.message === 'string' ? j.message : (j && typeof j.error === 'string' ? j.error : '');
  if (status === 429) return { outcome: 'retry', code: 'http_429', text: 'Provider rate limit', retryS: Math.min(Math.max(Number(retryAfter) || 30, 5), 600) };
  if (status === 401 || status === 403) return { outcome: 'blocked', code: 'http_' + status, text: 'Provider rejected our credentials' };
  if (status >= 500 || status === 0) return { outcome: 'unknown', code: 'http_' + status, text: 'Provider error; delivery unconfirmed' };
  const m = j && Array.isArray(j.messages) ? j.messages[0] : null;
  const st = m && m.status && typeof m.status === 'object' ? m.status : null;
  if (!st) {
    if (status >= 200 && status < 300) return { outcome: 'unknown', code: 'unreadable', text: 'Unreadable provider answer; delivery unconfirmed' };
    return { outcome: 'blocked', code: 'http_' + status, text: ('Unexpected provider answer: ' + msg).slice(0, 160) };   // a systematic 4xx: pause instead of failing every message
  }
  const id = Number(st.id), group = Number(st.groupId), name = String(st.name || '').slice(0, 60);
  const mid = m.messageId !== undefined && m.messageId !== null ? String(m.messageId) : '';
  if (ST_OK[id] || (group === 18 && !ST_FAIL[id] && !ST_BLOCK[id])) {
    if (!mid) return { outcome: 'unknown', code: 'no_message_id', text: 'Accepted but no message id returned' };
    return { outcome: 'submitted', requestId: mid, code: String(id), text: name, price: Number(m.price) || null };
  }
  if (ST_BLOCK[id]) return { outcome: 'blocked', code: String(id), text: BLOCK_TEXT[id] };
  if (ST_RETRY[id]) return { outcome: 'retry', code: String(id), text: name || 'Provider asked to retry', retryS: ST_RETRY[id] };
  if (ST_UNKNOWN[id]) return { outcome: 'unknown', code: String(id), text: ST_UNKNOWN[id] + '; delivery unconfirmed' };
  if (ST_FAIL[id]) return { outcome: 'failed', code: String(id), text: (ST_FAIL[id] + (name ? ': ' + name : '')).slice(0, 160) };
  if (group === 19 || group === 22) return { outcome: 'failed', code: String(id || group), text: ('Rejected: ' + name).slice(0, 160) };
  return { outcome: 'unknown', code: 'unclassified', text: 'Unclassified provider answer' };
}

let mockLog = [];
function mockSend(r) {
  mockLog.push({ phone: r.phone, body: r.body, sender: r.sender });
  const tail = r.phone.slice(-3);
  if (tail === '000') return { outcome: 'failed', code: '101', text: 'invalid_number' };
  if (tail === '111') return { outcome: 'unknown', code: '103', text: 'Provider timeout; delivery unconfirmed' };
  if (tail === '222') return r.attempts < 2 ? { outcome: 'retry', code: 'http_429', text: 'Provider rate limit', retryS: 5 } : { outcome: 'submitted', requestId: 'MOCK-' + r.id.slice(0, 8), code: '100', text: 'mock' };
  return { outcome: 'submitted', requestId: 'MOCK-' + r.id.slice(0, 8), code: '100', text: 'mock' };
}

async function send(r) {
  const c = env();
  if (c.mock) return mockSend(r);
  try {
    const path = c.test ? '/api/sms/v2/test/text/single' : '/api/sms/v2/text/single';
    const res = await http(c.base + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: authHeader(c) },
      body: JSON.stringify({ from: r.sender, to: r.phone, text: r.body, flash: 0, reference: String(r.id || '').replace(/-/g, '').slice(0, 20) })
    }, c.timeout);
    const t = await res.text();
    return classify(res.status, t, res.headers.get('retry-after'));
  } catch (e) {
    return { outcome: 'unknown', code: 'timeout', text: 'No answer from the provider; delivery unconfirmed' };
  }
}

/* delivery report for one message: delivered | failed | pending | auth | error */
async function dlrOf(d) {
  const c = env();
  if (c.mock) return d.request_id.startsWith('MOCK-') ? { status: 'delivered' } : { status: 'pending' };
  try {
    const res = await http(c.base + '/api/v2/reports?messageId=' + encodeURIComponent(d.request_id), { headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: authHeader(c) } }, c.timeout);
    if (res.status === 404) return { status: 'pending' };
    if (res.status === 401 || res.status === 403) return { status: 'auth' };
    if (!res.ok) return { status: 'error' };
    const j = parseJson(await res.text());
    const list = j && Array.isArray(j.results) ? j.results : null;
    if (!list) return { status: 'error' };
    const e = list.find(x => x && String(x.messageId) === String(d.request_id));
    if (!e || !e.status) return { status: 'pending' };
    const id = Number(e.status.id), group = Number(e.status.groupId), name = String(e.status.name || '').slice(0, 40);
    if (id === 73 || id === 108) return { status: 'delivered' };
    if (ST_FAIL[id] || group === 19 || group === 22) return { status: 'failed', detail: 'Reported by the operator: ' + (name || ST_FAIL[id] || 'not delivered') };
    return { status: 'pending' };
  } catch (e) { return { status: 'error' }; }
}

async function runQueue(opt) {
  const c = env(), o = opt || {}, t0 = Date.now(), deadline = t0 + (o.budgetMs || c.budget);
  const st = { claimed: 0, submitted: 0, failed: 0, unknown: 0, retry: 0, blocked: 0, delivered: 0, dlr_failed: 0, dlr_checked: 0, mode: null, note: null };
  const cfg = await rpc('msg_w_config');
  st.mode = cfg.mode;
  if (cfg.mode === 'off') { st.note = 'sending_off'; return st; }
  const conc = Math.min(Math.max(Number(cfg.concurrency) || 5, 1), 20), cap = Math.min(Math.max(Number(cfg.batch) || 100, 1), 500) * 4;
  if (Number(cfg.pending) > 0 && !cfg.blocked_until) {
    if (!providerConfigured()) { st.note = 'provider_not_configured'; }
    else {
      let stop = false;
      while (!stop && st.claimed < cap && Date.now() < deadline - (c.timeout + 4000)) {
        const batch = await rpc('msg_w_claim', { p_limit: conc });
        if (!Array.isArray(batch) || !batch.length) break;
        st.claimed += batch.length;
        await Promise.all(batch.map(async r => {
          let res; try { res = await send(r); } catch (e) { res = { outcome: 'unknown', code: 'exception', text: 'Internal error while sending' }; }
          st[res.outcome] = (st[res.outcome] || 0) + 1;
          if (res.outcome === 'blocked') stop = true;
          try { await rpc('msg_w_record', { p_id: r.id, p_outcome: res.outcome, p_request_id: res.requestId || null, p_code: res.code || null, p_text: res.text || null, p_retry_s: res.retryS || null }); }
          catch (e) { /* stays 'sending'; the database turns it into 'unknown' after 5 minutes. It is never re-sent. */ }
        }));
      }
    }
  } else if (cfg.blocked_until) st.note = 'provider_blocked';
  if (Number(cfg.dlr_due) > 0 && providerConfigured() && Date.now() < deadline - (c.timeout + 2000)) {
    const due = await rpc('msg_w_dlr_due', { p_limit: 60 });
    for (let i = 0; Array.isArray(due) && i < due.length && Date.now() < deadline - (c.timeout + 500); i += conc) {
      const part = due.slice(i, i + conc); let auth = false;
      await Promise.all(part.map(async d => {
        const r = await dlrOf(d); st.dlr_checked++;
        if (r.status === 'auth') { auth = true; return; }
        if (r.status === 'delivered' || r.status === 'failed') {
          if (r.status === 'delivered') st.delivered++; else st.dlr_failed++;
          try { await rpc('msg_w_dlr_apply', { p_id: d.id, p_status: r.status, p_detail: r.detail || null }); } catch (e) {}
        }
      }));
      if (auth) { try { await rpc('msg_w_provider_state', { p_blocked_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(), p_reason: '401 Provider rejected our credentials (delivery reports)' }); } catch (e) {} break; }
    }
  }
  return st;
}

function sendJson(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); }
function bodyOf(req) { const b = req.body; if (b && typeof b === 'object') return b; try { return JSON.parse(b || '{}'); } catch (e) { return {}; } }

module.exports = { env, dbConfigured, providerConfigured, hasCreds, rpc, userOf, isAdmin, cronOk, authHeader, http, parseJson, classify, send, dlrOf, runQueue, sendJson, bodyOf, mockLog: () => mockLog, resetMock: () => { mockLog = []; } };
