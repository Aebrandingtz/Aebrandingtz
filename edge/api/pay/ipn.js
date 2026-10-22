/* Pesapal IPN (GET or POST). The call carries NO payment status, and anyone can call this URL, so it is only a hint:
   we ask Pesapal for the real status with our credentials and record it. Replays and forged calls change nothing. */
'use strict';
const P = require('../_lib/pay');
module.exports = async (req, res) => {
  const q = Object.assign({}, req.query || {}, P.bodyOf(req));
  const tracking = String(q.OrderTrackingId || q.orderTrackingId || ''), type = String(q.OrderNotificationType || q.orderNotificationType || 'IPNCHANGE').slice(0, 20), mref = String(q.OrderMerchantReference || q.orderMerchantReference || '').slice(0, 60);
  const echo = status => ({ orderNotificationType: type, orderTrackingId: tracking.slice(0, 64), orderMerchantReference: mref, status });
  if (!P.configured() || !P.TRACK_RX.test(tracking)) return P.send(res, 200, echo(200));
  try {
    if (!(await P.rpc('tk_pay_rate', { p_key: 'payipn:ip:' + P.ipOf(req), p_limit: 120, p_window: 600 }))) return P.send(res, 200, echo(200));
    const r = await P.settleTracking(tracking);
    if (r && r.error === 'status_unavailable') return P.send(res, 500, echo(500));   /* Pesapal will retry */
    return P.send(res, 200, echo(200));
  } catch (e) { return P.send(res, 500, echo(500)); }
};
