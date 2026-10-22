/* SHEREHE HUB bulk SMS: shared helpers (Beem Africa adapter + queue worker).
   Secrets come only from environment variables: BEEM_API_KEY, BEEM_API_SECRET, SUPABASE_SERVICE_ROLE_KEY, MSG_CRON_SECRET.
   Endpoints and codes below are taken from Beem's own documentation (docs.beem.africa, SMS API):
     POST {base}/v1/send                     base = https://apisms.beem.africa (production) | https://dev-sms.beem.africa (staging)
     GET  {base}/public/v1/vendors/balance   -> { data: { credit_balance } }
     GET  {base}/public/v1/sender-names      -> { data: [ { senderid, status, ... } ] }
     GET  https://dlrapi.beem.africa/public/v1/delivery-reports?dest_addr=&request_id=  -> [ { dest_addr, status, request_id } ]  (PENDING | DELIVERED | UNDELIVERED)
   A message is never marked "sent" on a guess: only Beem's code 100 with request_id counts as "submitted to the operator";
   "delivered" only comes from a delivery report. Anything unclear (timeouts, 5xx, unreadable answers) becomes "unknown" and is NEVER re-sent automatically. */
'use strict';
const crypto = require('crypto');
const DEFAULT_SB = 'https://ajxybsfhckdxzslpsnjb.supabase.co';

function env() {
  const staging = process.env.BEEM_ENV === 'staging';
  const mock = process.env.MSG_PROVIDER === 'mock' && process.env.VERCEL_ENV !== 'production'; // the mock can never run in production
  return {
    mock, staging,
    key: process.env.BEEM_API_KEY, secret: process.env.BEEM_API_SECRET,
    base: (process.env.BEEM_BASE_URL || (staging ? 'https://dev-sms.beem.africa' : 'https://apisms.beem.africa')).replace(/\/+$/, ''),
    dlr: (process.env.BEEM_DLR_URL || 'https://dlrapi.beem.africa').replace(/\/+$/, ''),
    sb: process.env.SUPABASE_URL || DEFAULT_SB, sbKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    cron: process.env.MSG_CRON_SECRET,
    timeout: Number(process.env.MSG_HTTP_TIMEOUT_MS) || 8000,
    budget: Number(process.env.MSG_RUN_BUDGET_MS) || 40000
  };
}
const dbConfigured = () => !!env().sbKey;
const providerConfigured = () => { const c = env(); return c.mock || !!(c.key && c.secret); };

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

const basic = c => 'Basic ' + Buffer.from(c.key + ':' + c.secret).toString('base64');
async function http(url, opt, ms) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, Object.assign({}, opt, { signal: ac.signal })); } finally { clearTimeout(t); }
}

/* Turn Beem's answer into one of our outcomes. Pure function (tested).
   outcome: submitted | retry | blocked | failed | unknown */
const PERMANENT = { 101: 'invalid_number', 104: 'bad_request', 109: 'invalid_message', 110: 'unsupported_characters', 111: 'sender_not_active', 112: 'bad_schedule', 113: 'bad_request', 114: 'too_many_recipients', 115: 'bad_request', 116: 'bad_request', 117: 'bad_schedule', 118: 'bad_request', 119: 'bad_request', 121: 'sender_invalid', 122: 'sender_duplicate', 123: 'bad_request' };
function classify(status, json, retryAfter) {
  const j = json && typeof json === 'object' ? json : null;
  const code = j && j.code !== undefined ? Number(j.code) : NaN;
  const msg = j && typeof j.message === 'string' ? j.message : (j && typeof j.error === 'string' ? j.error : '');
  if (status === 429) return { outcome: 'retry', code: 'http_429', text: 'Provider rate limit', retryS: Math.min(Math.max(Number(retryAfter) || 30, 5), 600) };
  if (status === 401 || code === 120) return { outcome: 'blocked', code: '120', text: 'Provider rejected our credentials' };
  if (status === 400 && j && j.error && Number.isNaN(code)) return { outcome: 'blocked', code: 'auth_header', text: 'Provider says no authorization header: ' + msg.slice(0, 80) };
  if (status >= 500 || status === 0) return { outcome: 'unknown', code: 'http_' + status, text: 'Provider error; delivery unconfirmed' };
  if (code === 100 || (j && j.successful === true && Number.isNaN(code))) {
    const rid = j && j.request_id !== undefined && j.request_id !== null ? String(j.request_id) : '';
    if (!rid) return { outcome: 'unknown', code: 'no_request_id', text: 'Accepted but no request id returned' };
    if (j.valid === 0 || (Number(j.invalid) > 0 && !(Number(j.valid) > 0))) return { outcome: 'failed', code: 'invalid_number', text: 'Number rejected by the provider', requestId: rid };
    if (Number(j.opted_out) > 0 && !(Number(j.valid) > 0)) return { outcome: 'failed', code: 'opted_out', text: 'Recipient opted out at the provider', requestId: rid };
    return { outcome: 'submitted', requestId: rid, code: '100', text: msg.slice(0, 100) };
  }
  if (code === 102) return { outcome: 'blocked', code: '102', text: 'Provider account balance is too low' };
  if (code === 103) return { outcome: 'unknown', code: '103', text: 'Provider timeout; delivery unconfirmed' };
  if (PERMANENT[code]) return { outcome: 'failed', code: String(code), text: (PERMANENT[code] + (msg ? ': ' + msg : '')).slice(0, 160) };
  if (status >= 200 && status < 300) return { outcome: 'unknown', code: 'unreadable', text: 'Unreadable provider answer; delivery unconfirmed' };
  if (status >= 400 && status < 500) return { outcome: 'failed', code: 'http_' + status, text: ('Rejected: ' + msg).slice(0, 160) };
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
    const res = await http(c.base + '/v1/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: basic(c) },
      body: JSON.stringify({ source_addr: r.sender, schedule_time: '', encoding: 0, message: r.body, recipients: [{ recipient_id: 1, dest_addr: r.phone }] })
    }, c.timeout);
    const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
    return classify(res.status, j, res.headers.get('retry-after'));
  } catch (e) {
    return { outcome: 'unknown', code: 'timeout', text: 'No answer from the provider; delivery unconfirmed' };
  }
}

/* delivery report for one message: delivered | failed | pending | auth | error */
async function dlrOf(d) {
  const c = env();
  if (c.mock) return d.request_id.startsWith('MOCK-') ? { status: 'delivered' } : { status: 'pending' };
  try {
    const res = await http(c.dlr + '/public/v1/delivery-reports?dest_addr=' + encodeURIComponent(d.phone) + '&request_id=' + encodeURIComponent(d.request_id), { headers: { Accept: 'application/json', Authorization: basic(c) } }, c.timeout);
    if (res.status === 404) return { status: 'pending' };
    if (res.status === 401) return { status: 'auth' };
    if (!res.ok) return { status: 'error' };
    const j = await res.json().catch(() => null);
    const e = Array.isArray(j) ? j.find(x => x && String(x.request_id) === String(d.request_id)) || j[0] : null;
    const s = e && String(e.status || '').toUpperCase();
    if (s === 'DELIVERED') return { status: 'delivered' };
    if (s === 'UNDELIVERED') return { status: 'failed', detail: 'Reported as undelivered by the operator' };
    if (s === 'PENDING') return { status: 'pending' };
    return { status: 'error' };
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
      if (auth) { try { await rpc('msg_w_provider_state', { p_blocked_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(), p_reason: '120 Provider rejected our credentials (delivery reports)' }); } catch (e) {} break; }
    }
  }
  return st;
}

function sendJson(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); }
function bodyOf(req) { const b = req.body; if (b && typeof b === 'object') return b; try { return JSON.parse(b || '{}'); } catch (e) { return {}; } }

module.exports = { env, dbConfigured, providerConfigured, rpc, userOf, isAdmin, cronOk, basic, http, classify, send, dlrOf, runQueue, sendJson, bodyOf, mockLog: () => mockLog, resetMock: () => { mockLog = []; } };
