/* SHEREHE HUB payments: shared helpers for the Pesapal functions.
   Secrets come only from environment variables (PESAPAL_CONSUMER_KEY, PESAPAL_CONSUMER_SECRET, SUPABASE_SERVICE_ROLE_KEY).
   Payment status is NEVER taken from the browser, a redirect or an IPN call: it is always asked from Pesapal with our own credentials. */
'use strict';
const PROVIDER = 'pesapal';
const DEFAULT_SB = 'https://ajxybsfhckdxzslpsnjb.supabase.co';
const REF_RX = /^(SH-[0-9A-F]{10})-(\d{1,2})$/;
const TRACK_RX = /^[A-Za-z0-9-]{8,64}$/;

function env() {
  const live = process.env.PESAPAL_ENV === 'live';
  return {
    mode: live ? 'live' : 'sandbox',
    key: process.env.PESAPAL_CONSUMER_KEY, secret: process.env.PESAPAL_CONSUMER_SECRET,
    base: process.env.PESAPAL_BASE_URL || (live ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3'),
    sb: process.env.SUPABASE_URL || DEFAULT_SB, sbKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    origin: (process.env.SITE_ORIGIN || 'https://www.sherehehubtz.com').replace(/\/+$/, '')
  };
}
const configured = () => { const c = env(); return !!(c.key && c.secret && c.sbKey); };

async function rpc(fn, args) {
  const c = env();
  const h = { apikey: c.sbKey, 'Content-Type': 'application/json' };
  if (/^eyJ/.test(c.sbKey || '')) h.Authorization = 'Bearer ' + c.sbKey;
  const r = await fetch(c.sb + '/rest/v1/rpc/' + fn, { method: 'POST', headers: h, body: JSON.stringify(args || {}) });
  const t = await r.text();
  if (!r.ok) throw new Error('db ' + fn + ' ' + r.status);
  try { return JSON.parse(t); } catch (e) { return t; }
}

let tok = { v: null, exp: 0, base: '' };
async function pesaToken() {
  const c = env();
  if (tok.v && tok.base === c.base && Date.now() < tok.exp) return tok.v;
  const r = await fetch(c.base + '/api/Auth/RequestToken', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ consumer_key: c.key, consumer_secret: c.secret }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new Error('pesapal auth failed');
  tok = { v: j.token, exp: Date.now() + 4 * 60 * 1000, base: c.base };
  return tok.v;
}
async function pesa(method, path, body) {
  const c = env(); const t = await pesaToken();
  const r = await fetch(c.base + path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
}

async function ensureIpn() {
  const c = env(), key = 'pesapal_ipn_' + c.mode;
  const have = await rpc('tk_pay_setting', { p_key: key });
  if (have) return have;
  const r = await pesa('POST', '/api/URLSetup/RegisterIPN', { url: c.origin + '/api/pay/ipn', ipn_notification_type: 'GET' });
  const id = r.json && r.json.ipn_id; if (!id) throw new Error('pesapal ipn registration failed');
  await rpc('tk_pay_setting', { p_key: key, p_value: id });
  return id;
}

/* ask Pesapal what really happened; returns a normalized outcome */
async function statusOf(tracking) {
  const r = await pesa('GET', '/api/Transactions/GetTransactionStatus?orderTrackingId=' + encodeURIComponent(tracking));
  const j = r.json || {};
  if (r.status !== 200 || j.error || j.status_code === undefined || j.status_code === null) return { ok: false };
  const code = Number(j.status_code), desc = String(j.payment_status_description || '').toUpperCase();
  const outcome = code === 1 || desc === 'COMPLETED' ? 'completed' : code === 2 || desc === 'FAILED' ? 'failed' : code === 3 || desc === 'REVERSED' ? 'reversed' : 'pending';
  const a = Number(j.amount), cents = Math.round(a * 100);
  const amount = Number.isFinite(a) && cents % 100 === 0 && a >= 0 ? cents / 100 : -1;
  return { ok: true, outcome, amount, currency: String(j.currency || ''), merchant_reference: String(j.merchant_reference || ''),
    raw: { status_code: code, status: desc, method: j.payment_method || null, amount: j.amount, currency: j.currency, confirmation_code: j.confirmation_code || null, merchant_reference: j.merchant_reference || null, created_date: j.created_date || null } };
}

/* verify one payment with Pesapal and record the result (idempotent, safe to call many times) */
async function settleTracking(tracking) {
  if (!TRACK_RX.test(String(tracking || ''))) return { ok: false, error: 'bad_tracking' };
  const c = env();
  const mode = await rpc('tk_pay_mode');
  if (mode !== c.mode) return { ok: false, error: 'mode_mismatch' };
  const st = await statusOf(tracking);
  if (!st.ok) return { ok: false, error: 'status_unavailable' };
  /* the merchant reference that counts is the one Pesapal reports, never the one in the request */
  return await rpc('tk_pay_settle', { p_provider: PROVIDER, p_tracking: tracking, p_merchant_ref: st.merchant_reference, p_outcome: st.outcome, p_amount: st.amount, p_currency: st.currency, p_raw: st.raw });
}

const ipOf = req => String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.headers['x-real-ip'] || 'unknown').trim().slice(0, 60);
function send(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); }
function bodyOf(req) { const b = req.body; if (b && typeof b === 'object') return b; try { return JSON.parse(b || '{}'); } catch (e) { return {}; } }
function phone(p) { let d = String(p || '').replace(/[^0-9]/g, ''); if (!d) return ''; if (d.startsWith('0')) d = '255' + d.slice(1); return d.length >= 9 && d.length <= 15 ? d : ''; }

module.exports = { PROVIDER, REF_RX, TRACK_RX, env, configured, rpc, pesa, ensureIpn, statusOf, settleTracking, ipOf, send, bodyOf, phone };
