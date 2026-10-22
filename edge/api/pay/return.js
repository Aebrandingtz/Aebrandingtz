/* Pesapal sends the customer back here after paying (or cancelling). The redirect proves nothing: we verify with Pesapal, then send the customer to the order page. */
'use strict';
const P = require('../_lib/pay');
module.exports = async (req, res) => {
  const q = req.query || {}, tracking = String(q.OrderTrackingId || ''), m = P.REF_RX.exec(String(q.OrderMerchantReference || ''));
  if (P.configured() && P.TRACK_RX.test(tracking)) { try { await P.settleTracking(tracking); } catch (e) {} }
  res.statusCode = 302; res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', m ? '/#tk-pay=' + m[1] + (q.cancel ? '&c=1' : '') : '/#tk-find');
  res.end();
};
