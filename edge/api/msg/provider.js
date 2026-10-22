/* POST /api/msg/provider {action: 'status' | 'sync_senders'}  (administrators only)
   status: is Beem configured, its credit balance, its registered sender names.  sync_senders: copy Beem's sender names into our list (active ones become usable). */
'use strict';
const M = require('../_lib/msg');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return M.sendJson(res, 405, { ok: false, error: 'method' });
  if (!M.dbConfigured()) return M.sendJson(res, 503, { ok: false, error: 'not_configured' });
  const u = await M.userOf(req);
  if (!u || !(await M.isAdmin(u.id))) return M.sendJson(res, 403, { ok: false, error: 'forbidden' });
  const c = M.env(), action = String(M.bodyOf(req).action || 'status');
  const out = { ok: true, configured: !!(c.key && c.secret), environment: c.staging ? 'staging' : 'production', base: c.base, mock: c.mock };
  if (!out.configured && !c.mock) { out.note = 'BEEM_API_KEY / BEEM_API_SECRET are not set on the server'; return M.sendJson(res, 200, out); }
  if (c.mock) { out.balance = null; out.senders = []; return M.sendJson(res, 200, out); }
  try {
    const b = await M.http(c.base + '/public/v1/vendors/balance', { headers: { Accept: 'application/json', Authorization: M.basic(c) } }, c.timeout);
    if (b.status === 401) { out.auth = 'rejected'; return M.sendJson(res, 200, out); }
    const bj = await b.json().catch(() => null);
    out.auth = b.ok ? 'ok' : 'error';
    out.balance = bj && bj.data && typeof bj.data.credit_balance === 'number' ? bj.data.credit_balance : null;
    const s = await M.http(c.base + '/public/v1/sender-names?limit=100&page=1', { headers: { Accept: 'application/json', Authorization: M.basic(c) } }, c.timeout);
    const sj = s.ok ? await s.json().catch(() => null) : null;
    out.senders = sj && Array.isArray(sj.data) ? sj.data.map(x => ({ sender: String(x.senderid || ''), status: String(x.status || '') })) : [];
    if (action === 'sync_senders') {
      const items = out.senders.filter(x => /^[A-Za-z0-9 ]{3,11}$/.test(x.sender)).map(x => ({ sender: x.sender, active: x.status.toLowerCase() === 'active' }));
      out.synced = await M.rpc('msg_w_sender_sync', { p_items: items });
    }
    return M.sendJson(res, 200, out);
  } catch (e) { out.ok = false; out.error = 'provider_unreachable'; return M.sendJson(res, 200, out); }
};
