// ---------- HTML -> simplified blocks
export const MAX_BLOCKS = 500;
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', bull: '•', deg: '°', times: '×', eacute: 'é', euro: '€', pound: '£' };
export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ''; } }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'object', 'canvas', 'select', 'button', 'nav', 'footer', 'form', 'head', 'math']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'table', 'tr', 'td', 'th', 'figure', 'figcaption', 'header', 'aside', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'caption', 'details', 'summary', 'center', 'address']);
const SKIP_TOKEN = /^(navbox.*|reference|references|reflist.*|mw-references-wrap|mw-editsection|sidebar.*|metadata|noprint|catlinks|printfooter|mw-indicators|hatnote|toc|infobox.*|sistersitebox|mw-portlet.*|mw-footer.*|mw-jump-link|mw-cite-backlink|cookie.*|.*-banner|ad|ads|advert.*|social.*|share.*|breadcrumbs?|skip-link|visually-hidden|sr-only|screen-reader-text)$/i;
const skipClass = (cls) => cls.split(/\s+/).some(t => t && SKIP_TOKEN.test(t));

function attr(tag, name) {
  const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null;
}
export function simplify(html, baseUrl) {
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? decode(titleM[1]).replace(/\s+/g, ' ').trim() : '';
  const desc = (html.match(/<meta[^>]+name=["']description["'][^>]*>/i) || [])[0];
  let base = baseUrl;
  const baseTag = html.match(/<base[^>]+href=["']([^"']+)["']/i); if (baseTag) { try { base = new URL(baseTag[1], baseUrl).toString(); } catch {} }
  // Prefer main content when the page marks it
  let body = html;
  for (const tag of ['main', 'article', 'body']) {
    const a = html.search(new RegExp('<' + tag + '\\b', 'i'));
    if (a < 0) continue;
    const b = html.toLowerCase().lastIndexOf('</' + tag + '>');
    const chunk = b > a ? html.slice(a, b + tag.length + 3) : html.slice(a);
    if (chunk.length > 300) { body = chunk; break; }
  }
  if (body.length > 900000) body = body.slice(0, 900000);

  const blocks = []; const links = []; const images = [];
  let cur = null;          // current block {type, level?, spans:[]}
  let linkHref = null;
  let skipDepth = 0;       // >0 while inside a skipped element
  const stack = [];
  let pre = 0;
  const flush = () => {
    if (!cur) return;
    // merge + clean spans
    const spans = [];
    for (const s of cur.spans) {
      let t = pre ? s.text : s.text.replace(/\s+/g, ' ');
      if (!t) continue;
      const last = spans[spans.length - 1];
      if (last && !last.href && !s.href) last.text += t; else spans.push(s.href ? { text: t, href: s.href } : { text: t });
    }
    if (spans.length) { spans[0].text = spans[0].text.replace(/^\s+/, ''); const l = spans[spans.length - 1]; l.text = l.text.replace(/\s+$/, ''); }
    const text = spans.map(s => s.text).join('');
    if (text.trim() && blocks.length < MAX_BLOCKS) {
      const b = { type: cur.type, text: text.slice(0, 4000) };
      if (cur.level) b.level = cur.level;
      if (spans.some(s => s.href)) b.spans = spans.filter(s => s.text);
      blocks.push(b);
    }
    cur = null;
  };
  const ensure = () => { if (!cur) cur = { type: 'p', spans: [] }; return cur; };
  const re = /<!--[\s\S]*?-->|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(body)) && blocks.length < MAX_BLOCKS) {
    if (m[0].startsWith('<!') || m[0].startsWith('<?')) continue;
    if (m[4] !== undefined) { // text
      if (skipDepth) continue;
      const t = decode(m[4]);
      if (!t.trim() && !cur) continue;
      ensure().spans.push(linkHref ? { text: t, href: linkHref } : { text: t });
      continue;
    }
    const closing = m[1] === '/', name = m[2].toLowerCase(), rest = m[3] || '';
    if (!closing) {
      const selfClose = VOID.has(name) || rest.endsWith('/');
      if (!selfClose) {
        const cls = (attr(rest, 'class') || '') + ' ' + (attr(rest, 'id') || '');
        const hidden = /\bhidden\b/i.test(rest) && !/hidden\s*=\s*["']?false/i.test(rest) || /aria-hidden=["']true/i.test(rest) || /display\s*:\s*none/i.test(rest) || attr(rest, 'role') === 'navigation';
        const skip = skipDepth > 0 || SKIP_TAGS.has(name) || hidden || skipClass(cls);
        stack.push({ name, skip: skip && skipDepth === 0 });
        if (skip) skipDepth++;
      }
      if (skipDepth) continue;
      if (name === 'img') {
        let src = attr(rest, 'src') || attr(rest, 'data-src');
        if (src && !src.startsWith('data:')) {
          try { src = new URL(src, base).toString(); } catch { src = null; }
          const w = parseInt(attr(rest, 'width') || '999', 10);
          if (src && /^https?:/.test(src) && w >= 40 && images.length < 40) { flush(); images.push(src); blocks.push({ type: 'img', src, alt: (attr(rest, 'alt') || '').slice(0, 200) }); }
        }
        continue;
      }
      if (BLOCK.has(name)) {
        flush();
        if (/^h[1-6]$/.test(name)) cur = { type: 'h', level: +name[1], spans: [] };
        else if (name === 'li') cur = { type: 'li', spans: [] };
        else if (name === 'pre') { cur = { type: 'pre', spans: [] }; pre++; }
        else if (name === 'blockquote') cur = { type: 'quote', spans: [] };
        else if (name === 'hr') blocks.push({ type: 'hr', text: '' });
        continue;
      }
      if (name === 'a') {
        const href = attr(rest, 'href');
        if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
          try { const abs = new URL(href, base); if (/^https?:$/.test(abs.protocol)) { linkHref = abs.toString(); if (links.length < 300) links.push(linkHref); } } catch {}
        }
      }
    } else {
      // closing tag: pop to matching
      let idx = -1;
      for (let i = stack.length - 1; i >= 0 && i >= stack.length - 30; i--) if (stack[i].name === name) { idx = i; break; }
      if (idx >= 0) {
        while (stack.length > idx) { const e = stack.pop(); if (skipDepth) skipDepth--; }
        // recompute skipDepth from remaining stack
        skipDepth = 0; for (const e of stack) if (skipDepth || e.skip) skipDepth++;
      }
      if (skipDepth) continue;
      if (name === 'a') linkHref = null;
      else if (BLOCK.has(name)) { flush(); if (name === 'pre' && pre) pre--; }
    }
  }
  flush();
  return {
    ok: true, url: baseUrl, title: title || baseUrl,
    description: desc ? (attr(desc, 'content') || '') : '',
    blocks, links: [...new Set(links)].slice(0, 200), images,
  };
}

