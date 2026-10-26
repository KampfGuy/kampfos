// kampfos-proxy: fetches public web pages server-side for the KampfOS "Kompass" browser
// and returns a simplified, readable JSON version. Also powers the "Kugel" search engine.
import { simplify, decode } from './simplify.js';
const ALLOWED_ORIGINS = ['https://kampfguy.github.io'];
const MAX_BYTES = 1_500_000;      // max HTML bytes we read from a page
const MAX_REDIRECTS = 5;
const UA = 'Mozilla/5.0 (compatible; KampfOS-Kompass/1.0; +https://kampfguy.github.io/kampfos/)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function cors(req) {
  const o = req.headers.get('Origin');
  const h = { 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
  if (o && ALLOWED_ORIGINS.includes(o)) {
    h['Access-Control-Allow-Origin'] = o;
    h['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}
function json(req, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store' } });
}

// ---------- URL safety: http(s) only, no local/private hosts
function isPrivateHost(host) {
  host = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home') || host.endsWith('.arpa')) return true;
  if (host.includes(':')) { // IPv6 literal
    if (host === '::' || host === '::1') return true;
    if (/^(fc|fd|fe8|fe9|fea|feb)/.test(host)) return true;
    const m = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return isPrivateHost(m[1]);
    return false;
  }
  if (/^\d+$/.test(host) || /^0x/i.test(host)) return true; // decimal / hex-encoded IPs
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
  }
  return false;
}
function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('That is not a valid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http:// and https:// URLs are allowed');
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed');
  if (isPrivateHost(u.hostname)) throw new Error('Private / local addresses are blocked');
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) throw new Error('That port is blocked');
  return u;
}
async function safeFetch(raw, init = {}) {
  let url = checkUrl(raw).toString();
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const r = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'Accept-Language': 'en-US,en;q=0.8', ...(init.headers || {}) } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('Location')) {
      url = checkUrl(new URL(r.headers.get('Location'), url).toString()).toString();
      init = { ...init, method: 'GET', body: undefined };
      continue;
    }
    return { res: r, url };
  }
  throw new Error('Too many redirects');
}
async function readLimited(res, max = MAX_BYTES) {
  const reader = res.body.getReader();
  const chunks = []; let total = 0, truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { chunks.push(value.slice(0, value.byteLength - (total - max))); truncated = true; try { reader.cancel(); } catch {} break; }
    chunks.push(value);
  }
  const buf = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let o = 0; for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
  let charset = (res.headers.get('Content-Type') || '').match(/charset=([\w-]+)/i)?.[1] || 'utf-8';
  let text;
  try { text = new TextDecoder(charset).decode(buf); } catch { text = new TextDecoder().decode(buf); }
  return { text, truncated };
}

// ---------- Search
function cleanText(s) { return decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); }
function ddgUrl(href) {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    if (u.hostname.endsWith('duckduckgo.com') && u.pathname.startsWith('/l/')) return u.searchParams.get('uddg');
    if (u.hostname.endsWith('duckduckgo.com') && u.pathname.startsWith('/y.js')) return null; // ads
    return u.toString();
  } catch { return null; }
}
async function searchDDG(q) {
  const r = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST', signal: AbortSignal.timeout(3500),
    headers: { 'User-Agent': BROWSER_UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9', 'Referer': 'https://html.duckduckgo.com/' },
    body: 'q=' + encodeURIComponent(q) + '&kl=us-en',
  });
  if (!r.ok) throw new Error('ddg status ' + r.status);
  const html = await r.text();
  const out = [];
  const parts = html.split(/(?=<div[^>]+class="[^"]*\bresult\b[^"]*")/i).slice(1);
  for (const part of parts) {
    if (/result--ad|badge--ad/.test(part.slice(0, 600))) continue;
    const a = part.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) || part.match(/<a[^>]+href="([^"]+)"[^>]+class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = ddgUrl(decode(a[1]));
    if (!url || !/^https?:/.test(url) || /^https?:\/\/([^/]*\.)?duckduckgo\.com\//.test(url)) continue;
    const sn = part.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(a|div|td)>/i);
    out.push({ title: cleanText(a[2]), url, snippet: sn ? cleanText(sn[1]) : '' });
    if (out.length >= 10) break;
  }
  if (!out.length) throw new Error('ddg returned no results' + (/anomaly|captcha/i.test(html) ? ' (bot check)' : ''));
  return out;
}
async function searchDDGLite(q) {
  const r = await fetch('https://lite.duckduckgo.com/lite/', {
    method: 'POST', signal: AbortSignal.timeout(3000),
    headers: { 'User-Agent': BROWSER_UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'text/html', 'Referer': 'https://lite.duckduckgo.com/' },
    body: 'q=' + encodeURIComponent(q) + '&kl=us-en',
  });
  if (!r.ok) throw new Error('ddg-lite status ' + r.status);
  const html = await r.text();
  const out = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>)?/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 10) {
    const url = ddgUrl(decode(m[1]));
    if (!url || !/^https?:/.test(url)) continue;
    out.push({ title: cleanText(m[2]), url, snippet: m[3] ? cleanText(m[3]) : '' });
  }
  if (!out.length) throw new Error('ddg-lite returned no results');
  return out;
}
async function searchDDGInstant(q) {
  const r = await fetch('https://api.duckduckgo.com/?format=json&no_html=1&no_redirect=1&t=kampfos&q=' + encodeURIComponent(q), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error('ddg-instant status ' + r.status);
  const d = JSON.parse(await r.text() || '{}');
  const out = [];
  for (const x of d.Results || []) if (x.FirstURL && /^https?:/.test(x.FirstURL)) out.push({ title: (d.Heading ? d.Heading + ' — ' : '') + cleanText(x.Text || 'Official site'), url: x.FirstURL, snippet: cleanText(d.AbstractText || d.Abstract || '').slice(0, 240) });
  return out;
}
async function searchWikipedia(q) {
  const u = 'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=10&srprop=snippet&srsearch=' + encodeURIComponent(q);
  const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('wikipedia status ' + r.status);
  const d = await r.json();
  return (d.query?.search || []).map(s => ({ title: s.title + ' — Wikipedia', url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(s.title.replace(/ /g, '_')), snippet: cleanText(s.snippet) }));
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (req.method !== 'GET') return json(req, { ok: false, error: 'GET only' }, 405);
    const origin = req.headers.get('Origin');
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json(req, { ok: false, error: 'Origin not allowed' }, 403);

    const cache = caches.default;
    const cacheKey = new Request(url.toString() + (url.search ? '&' : '?') + '__v=5', { method: 'GET' });
    if (url.pathname === '/read' || url.pathname === '/search') {
      const hit = await cache.match(cacheKey);
      if (hit) { const h = new Headers(hit.headers); for (const [k, v] of Object.entries(cors(req))) h.set(k, v); h.set('X-Cache', 'HIT'); return new Response(hit.body, { status: hit.status, headers: h }); }
    }
    const store = (resp) => { if (resp.status === 200) { const c = resp.clone(); const h = new Headers(c.headers); h.delete('Access-Control-Allow-Origin'); ctx.waitUntil(cache.put(cacheKey, new Response(c.body, { status: 200, headers: h }))); } return resp; };

    try {
      if (url.pathname === '/read') {
        const target = url.searchParams.get('url');
        if (!target) return json(req, { ok: false, error: 'Missing ?url=' }, 400);
        const { res, url: finalUrl } = await safeFetch(target);
        const ct = res.headers.get('Content-Type') || '';
        if (!res.ok) return json(req, { ok: false, status: res.status, url: finalUrl, error: 'The site answered with HTTP ' + res.status }, 200);
        if (/^image\//.test(ct)) return store(json(req, { ok: true, url: finalUrl, title: finalUrl.split('/').pop(), blocks: [{ type: 'img', src: finalUrl, alt: '' }], links: [], images: [finalUrl] }));
        if (!/html|xml|text\/plain/.test(ct) && ct) return json(req, { ok: false, url: finalUrl, error: 'Kompass can only show web pages (this is ' + ct.split(';')[0] + ')' }, 200);
        const { text, truncated } = await readLimited(res);
        let page;
        if (/text\/plain/.test(ct)) page = { ok: true, url: finalUrl, title: finalUrl, blocks: text.slice(0, 200000).split(/\n{2,}/).slice(0, 500).map(t => ({ type: 'pre', text: t })), links: [], images: [] };
        else page = simplify(text, finalUrl);
        page.truncated = truncated;
        return store(json(req, page));
      }
      if (url.pathname === '/search') {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 300);
        if (!q) return json(req, { ok: false, error: 'Missing ?q=' }, 400);
        const errors = [];
        // Fire all engines at once. Prefer full DuckDuckGo results; otherwise merge
        // DuckDuckGo Instant Answer "official site" links with Wikipedia search.
        const wrap = (engine, p) => p.then(r => ({ engine, results: r }), e => ({ engine, results: [], error: e.message }));
        const ddgP = wrap('duckduckgo', searchDDG(q).catch(e => searchDDGLite(q).catch(e2 => { throw new Error(e.message + ' / lite: ' + e2.message); })));
        const iaP = wrap('duckduckgo-instant', searchDDGInstant(q));
        const wikiP = wrap('wikipedia', searchWikipedia(q));
        const ddg = await ddgP;
        if (ddg.results.length) return store(json(req, { ok: true, query: q, engine: 'duckduckgo', results: ddg.results }));
        errors.push('duckduckgo: ' + (ddg.error || 'no results'));
        const [ia, wiki] = await Promise.all([iaP, wikiP]);
        const seen = new Set(), merged = [];
        for (const r of [...ia.results, ...wiki.results]) { const k = r.url.replace(/\/$/, ''); if (!seen.has(k)) { seen.add(k); merged.push(r); } }
        if (ia.error) errors.push('instant: ' + ia.error); if (wiki.error) errors.push('wikipedia: ' + wiki.error);
        if (merged.length) return store(json(req, { ok: true, query: q, engine: [ia.results.length && 'duckduckgo-instant', wiki.results.length && 'wikipedia'].filter(Boolean).join(' + '), results: merged.slice(0, 12), fallbackNotes: errors }));
        return json(req, { ok: true, query: q, engine: 'none', results: [], errors });
      }
      if (url.pathname === '/' || url.pathname === '/health') return json(req, { ok: true, service: 'kampfos-proxy', endpoints: ['/read?url=', '/search?q='] });
      return json(req, { ok: false, error: 'Not found' }, 404);
    } catch (e) {
      return json(req, { ok: false, error: String(e.message || e) }, 200);
    }
  },
};
