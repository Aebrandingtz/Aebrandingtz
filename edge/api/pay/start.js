/* POST /api/pay/start  {ref, secret}  -> {ok, redirect_url}
   Creates a Pesapal order for an existing unpaid order. The amount always comes from our database, never from the browser. */
'use strict';
const P = require('../_lib/pay');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return P.send(res, 405, { ok: false, error: 'method' });
  if (!P.configured()) return P.send(res, 503, { ok: false, error: 'not_configured' });
  try {
    const b = P.bodyOf(req), ref = String(b.ref || '').toUpperCase().slice(0, 20), secret = String(b.secret || '').slice(0, 64);
    if (!/^SH-[0-9A-F]{10}$/.test(ref) || !/^[0-9a-f]{32}$/.test(secret)) return P.send(res, 400, { ok: false, error: 'bad_request' });
    const ip = P.ipOf(req);
    if (!(await P.rpc('tk_pay_rate', { p_key: 'paystart:ip:' + ip, p_limit: 20, p_window: 600 })) || !(await P.rpc('tk_pay_rate', { p_key: 'paystart:ref:' + ref, p_limit: 8, p_window: 600 }))) return P.send(res, 429, { ok: false, error: 'rate_limited' });
    const c = P.env(), mode = await P.rpc('tk_pay_mode');
    if (mode !== c.mode) return P.send(res, 409, { ok: false, error: 'payments_disabled' });
    const prep = await P.rpc('tk_pay_prepare', { p_ref: ref, p_secret: secret });
    if (!prep || !prep.ok) return P.send(res, prep && prep.error === 'not_found' ? 404 : 409, { ok: false, error: (prep && prep.error) || 'error' });
    const ipn = await P.ensureIpn();
    const mref = prep.ref + '-' + prep.attempt;
    const ph = P.phone(prep.buyer_phone), em = prep.buyer_email || '';
    if (!ph && !em) return P.send(res, 409, { ok: false, error: 'contact_required' });
    const title = String(prep.event_title || '').replace(/[^\w\s&.,'-]/g, '').slice(0, 60);
    const sub = await P.pesa('POST', '/api/Transactions/SubmitOrderRequest', {
      id: mref, currency: 'TZS', amount: Number(prep.total_tzs), description: ('SHEREHE HUB tiketi: ' + title).slice(0, 100),
      callback_url: c.origin + '/api/pay/return', cancellation_url: c.origin + '/api/pay/return?cancel=1', notification_id: ipn, redirect_mode: 'TOP_WINDOW',
      billing_address: { email_address: em || undefined, phone_number: ph || undefined, first_name: String(prep.buyer_name || '').split(' ')[0].slice(0, 40), country_code: 'TZ' }
    });
    const j = sub.json || {}; let host = '';
    try { const u = new URL(j.redirect_url); host = u.protocol === 'https:' ? u.hostname : ''; } catch (e) {}
    if (sub.status !== 200 || !j.order_tracking_id || !/(^|\.)pesapal\.com$/.test(host)) return P.send(res, 502, { ok: false, error: 'provider_error' });
    const att = await P.rpc('tk_pay_attempt', { p_order: prep.order_id, p_provider: P.PROVIDER, p_tracking: j.order_tracking_id, p_merchant_ref: mref, p_amount: Number(prep.total_tzs), p_raw: { mode: c.mode } });
    if (!att || !att.ok) return P.send(res, 409, { ok: false, error: (att && att.error) || 'error' });
    return P.send(res, 200, { ok: true, redirect_url: j.redirect_url });
  } catch (e) { return P.send(res, 500, { ok: false, error: 'server_error' }); }
};
