/* SHEREHE HUB: link previews + short redirects.
   /i/<event>/<guest>/<type>  -> the guest's invitation page (bots get a poster preview)
   /m/<event>                 -> the venue's Google Maps link (bots get the same poster preview)
   (link-preview robots only see the SHEREHE HUB logo, never the poster or the map) */
const SB = 'https://ajxybsfhckdxzslpsnjb.supabase.co';
const KEY = 'sb_publishable_nCCKoniOySrH3SnxwEkupg_GfsmdBp5';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOT = /bot|crawl|spider|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|twitter|linkedin|skype|embedly|preview|imessage|applebot|pinterest|viber|vkshare|google-read|bingpreview/i;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function meta(e) {
  const r = await fetch(SB + '/rest/v1/rpc/get_public_event_meta', {
    method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_event_id: e })
  });
  if (!r.ok) return null;
  return await r.json();
}
function safeHttp(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } }

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const k = String(q.k || ''), e = String(q.e || ''), g = String(q.g || ''), t = String(q.t || 'Single');
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'www.sherehehubtz.com';
    const origin = 'https://' + host;
    if (!UUID.test(e) || (k === 'i' && !UUID.test(g))) { res.statusCode = 302; res.setHeader('Location', '/'); return res.end(); }
    const ua = String(req.headers['user-agent'] || '');
    const bot = BOT.test(ua) || q.preview === '1';

    if (!bot) {
      let to = '/';
      if (k === 'i') to = '/#invite=' + encodeURIComponent(e) + '&guest=' + encodeURIComponent(g) + '&type=' + encodeURIComponent(t);
      else if (k === 'm') { const m = await meta(e); to = (m && safeHttp(m.maps)) || '/'; }
      res.statusCode = 302; res.setHeader('Location', to); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'User-Agent');
      return res.end();
    }

    /* link-preview robots: same look as the main page (title, short description and the SHEREHE HUB logo) */
    const url = origin + (k === 'm' ? '/m/' + e : '/i/' + e + '/' + g + '/' + encodeURIComponent(t));
    const title = 'SHEREHE HUB \u2014 Event Invitation Management';
    const desc = 'Create events, manage guests, send WhatsApp/SMS invitations with QR cards and check guests in on the day.';
    const img = origin + '/icon-512.png';
    const html = '<!doctype html><html lang="sw"><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<meta property="og:type" content="website"><meta property="og:site_name" content="SHEREHE HUB TZ">' +
      '<meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc) + '">' +
      '<meta property="og:url" content="' + esc(url) + '"><meta property="og:image" content="' + esc(img) + '">' +
      '<meta property="og:image:width" content="512"><meta property="og:image:height" content="512">' +
      '<meta name="twitter:card" content="summary"><meta name="twitter:title" content="' + esc(title) + '"><meta name="twitter:image" content="' + esc(img) + '">' +
      '<meta name="description" content="' + esc(desc) + '"></head><body><a href="' + esc(url) + '">' + esc(title) + '</a></body></html>';
    res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600'); res.setHeader('Vary', 'User-Agent');
    return res.end(html);
  } catch (err) {
    res.statusCode = 302; res.setHeader('Location', '/'); return res.end();
  }
};
