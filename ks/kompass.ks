# ============================================================
#  Kompass — a tiny web browser written in KampfScript
#  with Kugel, a search engine that is like Google but way simpler.
#
#  Uses two network built-ins (need the Network Card upgrade):
#    search(query) -> {ok, results: [{title, url, snippet}], engine, error}
#    fetch(url)    -> {ok, title, url, blocks: [...], error}
#  Feel free to hack on this file! (Files > /system/kompass.ks)
# ============================================================

let HOME = "kampf://home"
let history = []
let pos = -1
let PAGE_SIZE = 60
let current = nil

let win = window("Kompass", 900, 620)

# ---------- toolbar
let bar = row(win)
addstyle(bar, "toolbar")
let back_btn = button(bar, "◀", fn() { go_back() })
let fwd_btn = button(bar, "▶", fn() { go_forward() })
button(bar, "⟳", fn() { reload() })
button(bar, "⌂", fn() { navigate(HOME) })
let address = textbox(bar, "Search Kugel or type a URL", fn(t) { navigate(t) })
addstyle(address, "grow")
button(bar, "Go", fn() { navigate(gettext(address)) })

let page = scroll(win)
let status = label(win, "Ready", "status")

# ---------- helpers
fn looks_like_url(s) {
  if startswith(s, "http://") or startswith(s, "https://") or startswith(s, "kampf://") { return true }
  if contains(s, " ") { return false }
  let dot = indexof(s, ".")
  return dot > 0 and dot < len(s) - 2
}

fn domain(url) {
  let rest = url
  if contains(rest, "://") { rest = split(rest, "://")[1] }
  let host = split(rest, "/")[0]
  if startswith(host, "www.") { host = slice(host, 4) }
  return host
}

fn update_buttons() {
  enable(back_btn, pos > 0)
  enable(fwd_btn, pos < len(history) - 1)
}

fn navigate(input_text) {
  let q = trim(input_text)
  if q == "" { return }
  let target = q
  if not looks_like_url(q) {
    target = "kampf://search?q=" + q
  } else if not (startswith(q, "http://") or startswith(q, "https://") or startswith(q, "kampf://")) {
    target = "https://" + q
  }
  while len(history) > pos + 1 { pop(history) }
  push(history, target)
  pos = len(history) - 1
  open_page(target)
}

fn go_back() {
  if pos > 0 {
    pos -= 1
    open_page(history[pos])
  }
}

fn go_forward() {
  if pos < len(history) - 1 {
    pos += 1
    open_page(history[pos])
  }
}

fn reload() {
  if pos >= 0 { open_page(history[pos]) }
}

fn open_page(url) {
  update_buttons()
  clear(page)
  current = url
  if startswith(url, "kampf://search?q=") {
    let q = slice(url, 17)
    settext(address, q)
    render_search(q)
  } else {
    settext(address, url)
    if startswith(url, "kampf://") { render_internal(url) } else { render_web(url) }
  }
}

# ---------- Kugel logo (each letter its own colour)
fn kugel_logo(parent, style) {
  let logo = flow(parent)
  addstyle(logo, style)
  let letters = ["K", "u", "g", "e", "l"]
  let colors = ["#4285f4", "#ea4335", "#fbbc05", "#4285f4", "#34a853"]
  for i in range(len(letters)) {
    let s = text(logo, letters[i])
    setstyle(s, "color", colors[i])
  }
  return logo
}

# ---------- kampf://home — the Kugel search page
fn render_home() {
  settitle(win, "Kugel — Kompass")
  settext(address, "")
  let c = center(page)
  setstyle(c, "minHeight", "88%")
  kugel_logo(c, "logo")
  let box = row(c)
  addstyle(box, "searchbox")
  label(box, "🔍")
  let q = textbox(box, "Search the web with Kugel", fn(t) { navigate(t) })
  addstyle(q, "grow")
  let btns = row(c)
  addstyle(btns, "gbtns")
  button(btns, "Kugel Search", fn() { navigate(gettext(q)) })
  button(btns, "I'm Feeling Lucky", fn() { lucky(gettext(q)) })
  label(c, "A search costs " + str(price("search")) + " 🪙 · opening a page costs " + str(price("page")) + " 🪙", "muted")
  let chips = col(c)
  addstyle(chips, "cards")
  for t in ["cats", "how do computers work", "Mars rover", "pizza history"] {
    let b = button(chips, t, fn() { navigate(t) })
    addstyle(b, "chip")
  }
  let links = row(c)
  link(links, "About Kompass", fn() { navigate("kampf://about") })
  label(links, "·", "muted")
  link(links, "KampfOS News", fn() { navigate("kampf://news") })
  label(links, "·", "muted")
  link(links, "Help", fn() { navigate("kampf://help") })
  focus(q)
  settext(status, "Kugel home · offline page")
}

# price() reads the current cost of network actions from the OS
fn price(kind) {
  if has_upgrade("fiber") { return 1 }
  if kind == "search" { return 2 }
  return 3
}

fn lucky(q) {
  if trim(q) == "" { return }
  settext(status, "Feeling lucky…")
  let res = search(q)
  if res.ok and len(res.results) > 0 { navigate(res.results[0].url) } else { navigate(q) }
}

# ---------- search results page
fn render_search(q) {
  settitle(win, q + " — Kugel Search")
  let head = col(page)
  addstyle(head, "serp-head")
  let logo = kugel_logo(head, "logo-small")
  on_click(logo, fn() { navigate(HOME) })
  let box = row(head)
  addstyle(box, "searchbox")
  addstyle(box, "compact")
  let qbox = textbox(box, "Search", fn(t) { navigate(t) })
  addstyle(qbox, "grow")
  settext(qbox, q)
  button(box, "🔍", fn() { navigate(gettext(qbox)) })

  settext(status, "Searching Kugel for \"" + q + "\"…")
  let t0 = time()
  let res = search(q)
  if not res.ok {
    error_box(page, "Search failed", res.error)
    settext(status, "Search failed")
    return
  }
  let secs = round((time() - t0) / 1000, 2)
  label(page, "About " + str(len(res.results)) + " results (" + str(secs) + " seconds) · powered by " + res.engine, "meta")
  let list = col(page)
  addstyle(list, "results")
  if len(res.results) == 0 {
    label(list, "Your search - " + q + " - did not match any documents.", "p")
  }
  for r in res.results {
    let item = col(list)
    addstyle(item, "result")
    label(item, domain(r.url) + "  ›  " + r.url, "url")
    link(item, r.title, fn() { navigate(r.url) }, "result-title")
    if r.snippet != "" { label(item, r.snippet, "snippet") }
  }
  settext(status, "Done · " + str(len(res.results)) + " results")
}

# ---------- real web pages (simplified by the KampfOS proxy)
fn render_web(url) {
  settitle(win, domain(url) + " — Kompass")
  settext(status, "Loading " + url + " …")
  let p = fetch(url)
  if current != url { return }
  if not p.ok {
    error_box(page, "This page can't be shown", p.error)
    settext(status, "Error")
    return
  }
  settitle(win, p.title + " — Kompass")
  if p.url != url { settext(address, p.url) }
  let art = col(page)
  addstyle(art, "article")
  label(art, p.title, "h1")
  label(art, p.url, "url")
  render_blocks(art, p.blocks, 0, url)
  settext(status, "Done · " + str(len(p.blocks)) + " blocks · " + domain(p.url))
}

fn render_blocks(art, blocks, start, url) {
  let stop = min(start + PAGE_SIZE, len(blocks))
  let i = start
  while i < stop {
    let b = blocks[i]
    if b.type == "h" {
      let lvl = min(b.level + 1, 3)
      label(art, b.text, "h" + str(lvl))
    } else if b.type == "img" {
      image(art, b.src)
    } else if b.type == "hr" {
      hr(art)
    } else {
      let f = flow(art)
      addstyle(f, b.type)
      if b.spans {
        for s in b.spans {
          if s.href {
            link(f, s.text, fn() { navigate(s.href) })
          } else {
            text(f, s.text)
          }
        }
      } else {
        text(f, b.text)
      }
    }
    i += 1
  }
  if stop < len(blocks) {
    let more = button(art, "Show more ▼  (" + str(len(blocks) - stop) + " more blocks)", fn() {
      remove(more)
      render_blocks(art, blocks, stop, url)
    })
  }
}

fn error_box(parent, title, msg) {
  let box = col(parent)
  addstyle(box, "errorpage")
  label(box, "😵", "big")
  label(box, title, "h2")
  label(box, msg, "p")
  if contains(msg, "Network Card") {
    button(box, "Open the Shop", fn() { open_app("shop") })
  } else if contains(msg, "coins") {
    button(box, "Go mine coins ⛏", fn() { open_app("miner") })
  }
  link(box, "← Back to Kugel", fn() { navigate(HOME) })
}

# ---------- built-in kampf:// pages (work offline)
fn render_internal(url) {
  if url == "kampf://home" or url == "kampf://" { render_home()
    return }
  let box = col(page)
  addstyle(box, "internal")
  if url == "kampf://about" {
    settitle(win, "About Kompass")
    label(box, "🧭 About Kompass", "h1")
    label(box, "Kompass is a web browser written entirely in KampfScript, the programming language of KampfOS. Its source code lives in /system/kompass.ks — open it in KampfCode and change anything you like.", "p")
    label(box, "How it works", "h2")
    label(box, "Real browsers would be blocked from reading other websites, so Kompass asks the KampfOS proxy (a tiny Cloudflare Worker) to download the page and boil it down to headings, paragraphs, links and images. KampfScript then draws those with label(), link() and image().", "p")
    label(box, "Kugel search sends your query to the proxy, which asks DuckDuckGo (with Wikipedia as a backup) and returns titles, URLs and snippets.", "p")
    let r = row(box)
    button(r, "View source", fn() { open_app("code:/system/kompass.ks") })
    button(r, "Back to Kugel", fn() { navigate(HOME) })
  } else if url == "kampf://news" {
    settitle(win, "KampfOS News")
    label(box, "📰 KampfOS Daily", "h1")
    let news = [
      ["Local CPU refuses to run loop without payment", "\"Nothing in this OS is free,\" said the processor, before demanding another coin."],
      ["Coin Miner reports record pebble yields", "Analysts recommend the Pickaxe upgrade for serious miners."],
      ["Calculator now charges 1 coin per answer", "CoinCalc's CEO defends the price: \"Math is a premium experience.\""],
      ["Kugel search engine is like Google, but way simpler", "It has one box and two buttons. Experts are stunned."]
    ]
    for n in news {
      label(box, n[0], "h3")
      label(box, n[1], "p")
    }
    link(box, "← Back to Kugel", fn() { navigate(HOME) })
  } else if url == "kampf://help" {
    settitle(win, "Kompass Help")
    label(box, "❓ Using Kompass", "h1")
    label(box, "• Type words and press Enter to search with Kugel.\n• Type an address like example.com or https://en.wikipedia.org/wiki/Cat to open it directly.\n• Click any blue link to follow it. Use ◀ ▶ to go back and forward.\n• Internal pages: kampf://home, kampf://about, kampf://news, kampf://help", "p")
    label(box, "Costs", "h2")
    label(box, "Searching and loading pages need the Network Card (Shop) and cost coins. The Fiber Optic upgrade makes every request cost just 1 coin.", "p")
    link(box, "← Back to Kugel", fn() { navigate(HOME) })
  } else {
    label(box, "404 — kampf page not found", "h1")
    label(box, "There is no internal page called " + url, "p")
    link(box, "← Back to Kugel", fn() { navigate(HOME) })
  }
  settext(status, "Internal page")
}

# ---------- start
navigate(HOME)
