/* POST /api/msg/provider {action: 'status'}  (administrators only)
   status: is NextSMS configured, are the credentials accepted, and the account balance (TZS). NextSMS has no endpoint that lists sender IDs,
   so sender IDs are added by hand in Admin; 'sync_senders' answers with a short note and changes nothing. */
'use strict';
const M = require('../_lib/msg');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return M.sendJson(res, 405, { ok: false, error: 'method' });
  if (!M.dbConfigured()) return M.sendJson(res, 503, { ok: false, error: 'not_configured' });
  const u = await M.userOf(req);
  if (!u || !(await M.isAdmin(u.id))) return M.sendJson(res, 403, { ok: false, error: 'forbidden' });
  const c = M.env(), action = String(M.bodyOf(req).action || 'status');
  const out = { ok: true, provider: 'nextsms', configured: M.hasCreds(c), environment: c.test ? 'test' : 'live', base: c.base, mock: c.mock };
  if (action === 'sync_senders') { out.synced = null; out.note = 'NextSMS cannot list sender IDs. Add each approved sender ID by hand under Sender IDs.'; }
  if (!out.configured && !c.mock) { out.note = 'NEXTSMS_API_TOKEN is not set on the server'; return M.sendJson(res, 200, out); }
  if (c.mock) { out.balance = null; out.senders = []; return M.sendJson(res, 200, out); }
  try {
    const b = await M.http(c.base + '/api/v2/balance', { headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: M.authHeader(c) } }, c.timeout);
    if (b.status === 401 || b.status === 403) { out.auth = 'rejected'; return M.sendJson(res, 200, out); }
    const bj = M.parseJson(await b.text());
    out.auth = b.ok ? 'ok' : 'error';
    out.balance = bj && typeof bj.sms_balance === 'number' ? bj.sms_balance : null;
    out.balance_display = bj && typeof bj.display === 'string' ? bj.display.slice(0, 40) : null;
    out.balance_unit = bj && bj.type === 'price' ? 'TZS' : 'SMS';
    return M.sendJson(res, 200, out);
  } catch (e) { out.ok = false; out.error = 'provider_unreachable'; return M.sendJson(res, 200, out); }
};
