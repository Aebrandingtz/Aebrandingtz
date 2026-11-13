/* SHEREHE HUB: link previews + short redirects.
   /i/<event>/<guest>/<type>  -> the guest's invitation page (bots get a poster preview)
   /m/<event>                 -> the venue's Google Maps link (bots get the same poster preview)
   /c/<collection>            -> a photo collection (bots get the cover photo as preview)
   (link-preview robots see the event poster, title and venue name; never the map link) */
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
async function colMeta(id) {
  const r = await fetch(SB + '/rest/v1/rpc/get_public_collection', {
    method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: id })
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j && j.collection ? j.collection : null;
}
function safeHttp(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } }

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const k = String(q.k || ''), e = String(q.e || ''), g = String(q.g || ''), t = String(q.t || 'Single');
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'www.sherehehubtz.com';
    const origin = 'https://' + host;
    if (!UUID.test(e) || (k === 'i' && !UUID.test(g)) || (k !== 'i' && k !== 'm' && k !== 'c')) { res.statusCode = 302; res.setHeader('Location', '/'); return res.end(); }
    const ua = String(req.headers['user-agent'] || '');
    const bot = BOT.test(ua) || q.preview === '1';

    if (!bot) {
      let to = '/';
      if (k === 'i') to = '/#invite=' + encodeURIComponent(e) + '&guest=' + encodeURIComponent(g) + '&type=' + encodeURIComponent(t);
      else if (k === 'c') to = '/#collection=' + encodeURIComponent(e);
      else if (k === 'm') { const m = await meta(e); to = (m && safeHttp(m.maps)) || '/'; }
      res.statusCode = 302; res.setHeader('Location', to); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'User-Agent');
      return res.end();
    }

    /* link-preview robots: the event poster (falls back to the SHEREHE HUB logo when the event has none) */
    const url = origin + (k === 'm' ? '/m/' + e : k === 'c' ? '/c/' + e : '/i/' + e + '/' + g + '/' + encodeURIComponent(t));
    let title = 'SHEREHE HUB \u2014 Event Invitation Management';
    let desc = 'Create events, manage guests, send WhatsApp/SMS invitations with QR cards and check guests in on the day.';
    let img = origin + '/icon-512.png', big = false;
    if (k === 'c') {
      try {
        const c = await colMeta(e);
        if (c) {
          const p = safeHttp(c.cover_thumb || c.cover_url || '');
          title = String(c.title || 'Photo collection').slice(0, 80);
          desc = [c.studio_name, c.shoot_date].filter(Boolean).map(x => String(x).slice(0, 60)).join(' \u2014 ');
          desc = (desc ? desc + ' \u2014 ' : '') + 'Tazama picha / View photos';
          if (p) { img = p; big = true; }
        }
      } catch (x) { /* keep the default preview */ }
    } else try {
      const m = await meta(e);
      if (m) {
        const p = safeHttp((/double/i.test(t) && m.poster_url_double) || m.poster_url || m.poster_url_double || '');
        if (m.name) { title = String(m.name).slice(0, 80); desc = 'Umealikwa / You are invited' + (m.venue ? ' \u2014 ' + String(m.venue).slice(0, 80) : ''); }
        if (p) { img = p; big = true; }
      }
    } catch (x) { /* keep the default preview */ }
    const html = '<!doctype html><html lang="sw"><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<meta property="og:type" content="website"><meta property="og:site_name" content="SHEREHE HUB TZ">' +
      '<meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc) + '">' +
      '<meta property="og:url" content="' + esc(url) + '"><meta property="og:image" content="' + esc(img) + '">' +
      (big ? '' : '<meta property="og:image:width" content="512"><meta property="og:image:height" content="512">') +
      '<meta name="twitter:card" content="' + (big ? 'summary_large_image' : 'summary') + '"><meta name="twitter:title" content="' + esc(title) + '"><meta name="twitter:image" content="' + esc(img) + '">' +
      '<meta name="description" content="' + esc(desc) + '"></head><body><a href="' + esc(url) + '">' + esc(title) + '</a></body></html>';
    res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600'); res.setHeader('Vary', 'User-Agent');
    return res.end(html);
  } catch (err) {
    res.statusCode = 302; res.setHeader('Location', '/'); return res.end();
  }
};
