/* POST /api/pay/verify {ref, secret}: the order page asks while a payment is pending; we re-check the pending payments with Pesapal. */
'use strict';
const P = require('../_lib/pay');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return P.send(res, 405, { ok: false, error: 'method' });
  if (!P.configured()) return P.send(res, 503, { ok: false, error: 'not_configured' });
  try {
    const b = P.bodyOf(req), ref = String(b.ref || '').toUpperCase().slice(0, 20), secret = String(b.secret || '').slice(0, 64);
    if (!/^SH-[0-9A-F]{10}$/.test(ref) || !/^[0-9a-f]{32}$/.test(secret)) return P.send(res, 400, { ok: false, error: 'bad_request' });
    if (!(await P.rpc('tk_pay_rate', { p_key: 'payver:ip:' + P.ipOf(req), p_limit: 200, p_window: 600 })) || !(await P.rpc('tk_pay_rate', { p_key: 'payver:ref:' + ref, p_limit: 120, p_window: 600 }))) return P.send(res, 429, { ok: false, error: 'rate_limited' });
    const o = await P.rpc('tk_pay_for_order', { p_ref: ref, p_secret: secret });
    if (!o || !o.ok) return P.send(res, 404, { ok: false, error: 'not_found' });
    let status = o.status;
    for (const p of (o.pending || []).slice(0, 3)) {
      try { const r = await P.settleTracking(p.tracking); if (r && r.order_status) status = r.order_status; } catch (e) {}
    }
    return P.send(res, 200, { ok: true, status });
  } catch (e) { return P.send(res, 500, { ok: false, error: 'server_error' }); }
};
