/* Called on a schedule (Supabase pg_cron -> pg_net) with  Authorization: Bearer <RECONCILE_SECRET>.
   Re-checks payments that stayed pending (lost IPN, closed browser) against Pesapal. */
'use strict';
const crypto = require('crypto');
const P = require('../_lib/pay');
module.exports = async (req, res) => {
  const want = process.env.RECONCILE_SECRET || '', got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got), b = Buffer.from(want);
  if (!want || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return P.send(res, 401, { ok: false });
  if (!P.configured()) return P.send(res, 503, { ok: false, error: 'not_configured' });
  try {
    const list = await P.rpc('tk_pay_pending', { p_minutes: 3 }); let paid = 0, failed = 0, pending = 0, err = 0;
    for (const p of list.slice(0, 40)) {
      try { const r = await P.settleTracking(p.tracking); if (r && r.ok && r.order_status === 'paid') paid++; else if (r && r.payment === 'failed') failed++; else if (r && r.ok) pending++; else err++; } catch (e) { err++; }
    }
    return P.send(res, 200, { ok: true, checked: list.length, paid, failed, pending, errors: err });
  } catch (e) { return P.send(res, 500, { ok: false }); }
};
