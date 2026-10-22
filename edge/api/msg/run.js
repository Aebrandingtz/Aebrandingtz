/* POST /api/msg/run : the SMS queue worker.
   Called every minute by the database scheduler (Bearer MSG_CRON_SECRET) and right after a campaign is launched (Bearer = the user's own login token).
   It only works through database functions that reserve credits and claim recipients, so running it twice at once is safe. */
'use strict';
const M = require('../_lib/msg');
let running = false, lastUser = 0;
module.exports = async (req, res) => {
  if (req.method !== 'POST') return M.sendJson(res, 405, { ok: false, error: 'method' });
  if (!M.dbConfigured()) return M.sendJson(res, 503, { ok: false, error: 'not_configured' });
  let who = null;
  if (M.cronOk(req)) who = 'cron';
  else { const u = await M.userOf(req); if (u) who = 'user'; }
  if (!who) return M.sendJson(res, 401, { ok: false, error: 'unauthorized' });
  if (who === 'user' && Date.now() - lastUser < 3000) return M.sendJson(res, 200, { ok: true, skipped: 'recent' });
  if (running) return M.sendJson(res, 200, { ok: true, skipped: 'busy' });
  running = true; if (who === 'user') lastUser = Date.now();
  try {
    const st = await M.runQueue();
    return M.sendJson(res, 200, { ok: true, who, stats: st });
  } catch (e) { return M.sendJson(res, 500, { ok: false, error: 'server_error' }); }
  finally { running = false; }
};
