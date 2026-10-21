/* SHEREHE HUB: link previews + short redirects.
   /i/<event>/<guest>/<type>  -> the guest's invitation page (bots get a poster preview)
   /m/<event>                 -> the venue's Google Maps link (bots get the same poster preview)
   /og/<event>/<type>         -> a 1200x630 preview image made from the poster */
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
function posterOf(m, t) {
  const dbl = String(t || '').toLowerCase() === 'double' && m.poster_url_double;
  return (dbl ? m.poster_url_double : m.poster_url) || '';
}
function when(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const o = { timeZone: 'Africa/Dar_es_Salaam' };
  let day; try { day = d.toLocaleDateString('sw-TZ', { ...o, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch (x) { day = d.toDateString(); }
  const time = d.toLocaleTimeString('en-GB', { ...o, hour: '2-digit', minute: '2-digit', hour12: false });
  return day + ', ' + time;
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

    if (k === 'img') {
      const m = await meta(e); const p = m && posterOf(m, t);
      if (!p || !p.startsWith(SB + '/storage/v1/object/public/')) { res.statusCode = 404; return res.end('no poster'); }
      let sharp = null; try { sharp = require('sharp'); } catch (x) {}
      if (!sharp) { res.statusCode = 302; res.setHeader('Location', p); return res.end(); }
      const r = await fetch(p); if (!r.ok) { res.statusCode = 404; return res.end('no poster'); }
      const buf = Buffer.from(await r.arrayBuffer());
      const bg = await sharp(buf).rotate().resize(1200, 630, { fit: 'cover' }).blur(26).modulate({ brightness: 0.72 }).toBuffer();
      const fg = await sharp(buf).rotate().resize({ width: 1200, height: 630, fit: 'inside' }).toBuffer();
      const out = await sharp(bg).composite([{ input: fg, gravity: 'centre' }]).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      res.statusCode = 200; res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
      return res.end(out);
    }

    if (!bot) {
      let to = '/';
      if (k === 'i') to = '/#invite=' + encodeURIComponent(e) + '&guest=' + encodeURIComponent(g) + '&type=' + encodeURIComponent(t);
      else if (k === 'm') { const m = await meta(e); to = (m && safeHttp(m.maps)) || '/'; }
      res.statusCode = 302; res.setHeader('Location', to); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'User-Agent');
      return res.end();
    }

    /* link-preview robots: a small page with the poster as the cover picture */
    const m = await meta(e);
    const url = origin + (k === 'm' ? '/m/' + e : '/i/' + e + '/' + g + '/' + encodeURIComponent(t));
    const name = (m && m.name) || 'SHEREHE HUB';
    const w = m && m.date ? when(m.date) : '';
    const desc = k === 'm'
      ? 'Ramani ya ukumbi' + (m && m.venue ? ': ' + m.venue : '') + (w ? ' · ' + w : '')
      : 'Umealikwa! ' + (w ? w : '') + (m && m.venue ? ' · ' + m.venue : '') + ' — fungua mwaliko wako.';
    const img = m && posterOf(m, t) ? origin + '/og/' + e + '/' + encodeURIComponent(t) : origin + '/icon-512.png';
    const title = k === 'm' ? name + ' — Ramani' : name + ' — Mwaliko';
    const html = '<!doctype html><html lang="sw"><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<meta property="og:type" content="website"><meta property="og:site_name" content="SHEREHE HUB TZ">' +
      '<meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc) + '">' +
      '<meta property="og:url" content="' + esc(url) + '"><meta property="og:image" content="' + esc(img) + '">' +
      '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' +
      '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + esc(title) + '"><meta name="twitter:image" content="' + esc(img) + '">' +
      '<meta name="description" content="' + esc(desc) + '"></head><body><a href="' + esc(url) + '">' + esc(title) + '</a></body></html>';
    res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600'); res.setHeader('Vary', 'User-Agent');
    return res.end(html);
  } catch (err) {
    res.statusCode = 302; res.setHeader('Location', '/'); return res.end();
  }
};
