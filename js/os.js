/* KampfOS core: state, wallet, economy, virtual file system, window manager, dialogs, KampfScript runtime. */
(function () {
  'use strict';
  const K = window.KampfScript;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  };
  const PROXY = 'https://kampfos-proxy.kampfguy.workers.dev';

  // ------------------------------------------------------------------ State
  const STATE_KEY = 'kampfos.state.v1';
  const defaults = () => ({ coins: 100, upgrades: {}, theme: '', lastDaily: 0, log: [], stats: { earned: 0, spent: 0, runs: 0, clicks: 0, jobs: 0 }, bounties: {}, welcomed: false });
  let state;
  try { state = Object.assign(defaults(), JSON.parse(localStorage.getItem(STATE_KEY) || '{}')); } catch { state = defaults(); }
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => localStorage.setItem(STATE_KEY, JSON.stringify(state)), 150); };
  window.addEventListener('beforeunload', () => localStorage.setItem(STATE_KEY, JSON.stringify(state)));

  // ------------------------------------------------------------------ Wallet
  const listeners = new Set();
  const Wallet = {
    get coins() { return state.coins; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    _log(delta, reason) {
      const last = state.log[0];
      if (last && last.r === reason && Date.now() - last.t < 4000 && Math.sign(last.d) === Math.sign(delta)) { last.d += delta; last.t = Date.now(); }
      else state.log.unshift({ t: Date.now(), d: delta, r: reason });
      if (state.log.length > 60) state.log.length = 60;
    },
    add(n, reason, fromEl) {
      n = Math.round(n); if (n <= 0) return;
      state.coins += n; state.stats.earned += n; this._log(n, reason || 'Earned');
      save(); listeners.forEach(f => f(n, fromEl));
    },
    spend(n, reason) {
      n = Math.round(n); if (n <= 0) return true;
      if (state.coins < n) return false;
      state.coins -= n; state.stats.spent += n; this._log(-n, reason || 'Spent');
      save(); listeners.forEach(f => f(-n));
      return true;
    },
  };

  // ------------------------------------------------------------------ Shop / economy
  const SHOP = [
    { cat: 'CPU & Memory' },
    { id: 'turbo1', ico: '⚡', name: 'Turbo Compiler', price: 40, desc: 'Starting a program costs 2 🪙 instead of 3.' },
    { id: 'turbo2', ico: '🚀', name: 'Hyper Compiler', price: 120, needs: 'turbo1', desc: 'Starting a program costs just 1 🪙.' },
    { id: 'cache1', ico: '🧊', name: 'L2 Cache', price: 60, desc: 'Pay 1 🪙 per 2,500 steps instead of per 1,000.' },
    { id: 'cache2', ico: '🧠', name: 'Quantum Cache', price: 200, needs: 'cache1', desc: 'Pay 1 🪙 per 10,000 steps.' },
    { id: 'ram1', ico: '🧩', name: 'RAM Stick (64 MB)', price: 50, desc: 'Step limit per run: 20,000 → 100,000.' },
    { id: 'ram2', ico: '💾', name: 'RAM Tower (1 GB)', price: 180, needs: 'ram1', desc: 'Step limit per run: 100,000 → 1,000,000.' },
    { cat: 'APIs & Hardware' },
    { id: 'netcard', ico: '📡', name: 'Network Card', price: 40, desc: 'Unlocks fetch() and search() — the Kompass browser needs it! Search 2 🪙, page 3 🪙.' },
    { id: 'fiber', ico: '🌐', name: 'Fiber Optic Plan', price: 150, needs: 'netcard', desc: 'Every search or page load costs just 1 🪙.' },
    { id: 'gpu', ico: '🎨', name: 'GPU (Graphics Card)', price: 35, desc: 'Unlocks canvas() drawing: rectangles, circles, lines, text, clicks.' },
    { cat: 'Mining gear' },
    { id: 'pickaxe', ico: '⛏️', name: 'Steel Pickaxe', price: 25, desc: 'Coin Miner gives 2 🪙 per click.' },
    { id: 'drill', ico: '🛠️', name: 'Power Drill', price: 90, needs: 'pickaxe', desc: 'Coin Miner gives 4 🪙 per click.' },
    { id: 'automine', ico: '🤖', name: 'Auto-Miner Bot', price: 160, desc: 'Earns 1 🪙 every 6 seconds while KampfOS is open.' },
    { cat: 'Editor themes' },
    { id: 'theme-matrix', ico: '🟩', name: 'Theme: Matrix', price: 20, theme: 'theme-matrix', desc: 'Green-on-black hacker vibes.' },
    { id: 'theme-synth', ico: '🌆', name: 'Theme: Synthwave', price: 20, theme: 'theme-synth', desc: 'Neon pink and cyan, 1986 forever.' },
    { id: 'theme-paper', ico: '📜', name: 'Theme: Paper', price: 20, theme: 'theme-paper', desc: 'Calm light theme for daytime coding.' },
  ];
  const has = (id) => !!state.upgrades[id];
  const Economy = {
    SHOP, has,
    get runCost() { return has('turbo2') ? 1 : has('turbo1') ? 2 : 3; },
    get stepsPerCoin() { return has('cache2') ? 10000 : has('cache1') ? 2500 : 1000; },
    get maxSteps() { return has('ram2') ? 1000000 : has('ram1') ? 100000 : 20000; },
    get searchCost() { return has('fiber') ? 1 : 2; },
    get pageCost() { return has('fiber') ? 1 : 3; },
    get clickValue() { return has('drill') ? 4 : has('pickaxe') ? 2 : 1; },
    buy(id) {
      const it = SHOP.find(x => x.id === id); if (!it || has(id)) return false;
      if (it.needs && !has(it.needs)) { OS.toast('🔒', 'Buy ' + SHOP.find(x => x.id === it.needs).name + ' first.'); return false; }
      if (!Wallet.spend(it.price, 'Shop: ' + it.name)) { OS.toast('💸', 'Not enough coins for ' + it.name + '. Go mine some!'); return false; }
      state.upgrades[id] = Date.now(); save();
      if (it.theme) Economy.setTheme(it.theme);
      OS.toast(it.ico, 'Installed: ' + it.name);
      OS.emit('upgrades');
      return true;
    },
    setTheme(t) { state.theme = t || ''; document.body.classList.remove('theme-matrix', 'theme-synth', 'theme-paper'); if (t) document.body.classList.add(t); save(); },
    claimDaily() {
      const left = state.lastDaily + 20 * 3600e3 - Date.now();
      if (left > 0) return left;
      state.lastDaily = Date.now(); Wallet.add(50, 'Daily bonus'); return 0;
    },
    get dailyLeft() { return Math.max(0, state.lastDaily + 20 * 3600e3 - Date.now()); },
  };

  // ------------------------------------------------------------------ Virtual file system
  const FS_KEY = 'kampfos.fs.v1';
  const DEFAULT_FILES = {
    '/system/kompass.ks': 'ks/kompass.ks',
    '/system/coincalc.ks': 'ks/coincalc.ks',
    '/examples/hello.ks': 'ks/examples/hello.ks',
    '/examples/loops.ks': 'ks/examples/loops.ks',
    '/examples/functions.ks': 'ks/examples/functions.ks',
    '/examples/guess.ks': 'ks/examples/guess.ks',
    '/examples/clicker.ks': 'ks/examples/clicker.ks',
    '/examples/paint.ks': 'ks/examples/paint.ks',
    '/examples/bounce.ks': 'ks/examples/bounce.ks',
    '/examples/search_demo.ks': 'ks/examples/search_demo.ks',
    '/examples/infinite.ks': 'ks/examples/infinite.ks',
  };
  let fsData;
  try { fsData = JSON.parse(localStorage.getItem(FS_KEY) || '{}'); } catch { fsData = {}; }
  const fsSave = () => { try { localStorage.setItem(FS_KEY, JSON.stringify(fsData)); } catch (e) { OS.toast('⚠️', 'Disk full! (localStorage quota)'); } };
  const normPath = (p) => { p = String(p || '').trim(); if (!p.startsWith('/')) p = '/home/' + p; return p.replace(/\/+/g, '/'); };
  const FS = {
    defaultsLoaded: null,
    async loadDefaults(ver) {
      const entries = await Promise.all(Object.entries(DEFAULT_FILES).map(async ([path, url]) => {
        try { const r = await fetch(url + '?v=' + ver); return [path, r.ok ? await r.text() : null]; } catch { return [path, null]; }
      }));
      FS.originals = {};
      for (const [path, text] of entries) {
        if (text === null) continue;
        FS.originals[path] = text;
        const f = fsData[path];
        if (!f || (f.sys && !f.edited)) fsData[path] = { content: text, sys: true, edited: false, t: Date.now() };
      }
      if (!fsData['/home/notes.txt']) fsData['/home/notes.txt'] = { content: 'My KampfOS notes\n================\n- Buy the Network Card so Kompass can browse.\n- Mine coins when broke.\n', t: Date.now() };
      if (!fsData['/home/my_program.ks']) fsData['/home/my_program.ks'] = { content: '# My first KampfScript program\nprint("Hello from my program!")\n', t: Date.now() };
      fsSave();
    },
    read(p) { p = normPath(p); return fsData[p] ? fsData[p].content : null; },
    exists(p) { return !!fsData[normPath(p)]; },
    write(p, content) {
      p = normPath(p);
      if (String(content).length > 200000) throw new Error('File too big (max 200 KB)');
      const f = fsData[p];
      fsData[p] = Object.assign({}, f, { content: String(content), t: Date.now(), edited: f && f.sys ? true : undefined });
      fsSave(); OS.emit('fs'); return p;
    },
    remove(p) { p = normPath(p); delete fsData[p]; fsSave(); OS.emit('fs'); },
    list(prefix) { prefix = prefix ? normPath(prefix) : '/'; return Object.keys(fsData).filter(k => k.startsWith(prefix)).sort(); },
    restore(p) { if (FS.originals && FS.originals[p] !== undefined) { fsData[p] = { content: FS.originals[p], sys: true, edited: false, t: Date.now() }; fsSave(); OS.emit('fs'); return true; } return false; },
    restoreAll() { for (const p of Object.keys(FS.originals || {})) FS.restore(p); },
    normPath,
  };

  // ------------------------------------------------------------------ Event bus
  const bus = {};
  const OS = window.OS = {
    h, $, state, save, Wallet, Economy, FS, PROXY, K,
    on(ev, fn) { (bus[ev] = bus[ev] || new Set()).add(fn); return () => bus[ev].delete(fn); },
    emit(ev, d) { (bus[ev] || []).forEach(f => { try { f(d); } catch (e) { console.error(e); } }); },
  };

  // ------------------------------------------------------------------ Window manager
  let zTop = 100, winSeq = 0, activeWin = null;
  const wins = new Map();
  OS.wins = wins;
  function layerEl() { return $('#windows'); }
  function cascadePos(w, hgt) {
    const d = $('#desktop').getBoundingClientRect();
    const n = wins.size % 8;
    return { x: Math.max(100, Math.min(d.width - w - 10, 130 + n * 28)), y: Math.max(8, Math.min(d.height - hgt - 50, 30 + n * 26)) };
  }
  OS.createWindow = function (o) {
    const id = 'w' + (++winSeq);
    const dw = $('#desktop').clientWidth, dh = $('#desktop').clientHeight - 44;
    const width = Math.min(o.width || 480, dw - 20), height = Math.min(o.height || 360, dh - 10);
    const pos = (o.x !== undefined) ? { x: o.x, y: o.y } : cascadePos(width, height);
    const title = h('span', { class: 'wt-text', text: o.title || 'Window' });
    const minB = h('button', { class: 'btn wt-btn', title: 'Minimize', text: '▁' });
    const maxB = h('button', { class: 'btn wt-btn', title: 'Maximize', text: '□' });
    const closeB = h('button', { class: 'btn wt-btn close', title: 'Close', text: '✕' });
    const bar = h('div', { class: 'win-title' }, h('span', { class: 'wt-ico', text: o.icon || '🗔' }), title, minB, o.resizable === false ? null : maxB, closeB);
    const body = h('div', { class: 'win-body' });
    const el = h('div', { class: 'win opening', id, style: `left:${pos.x}px;top:${pos.y}px;width:${width}px;height:${height}px` }, bar, body);
    if (o.resizable !== false) for (const d of ['r', 'b', 'l', 'br']) el.append(h('div', { class: 'win-rs ' + d, 'data-d': d }));
    const task = h('button', { class: 'btn task' }, h('span', { text: o.icon || '🗔' }), h('span', { class: 't', text: o.title || 'Window' }));
    const win = {
      id, el, body, task, app: o.app, minimized: false, maximized: false, onClose: [],
      setTitle(t) { title.textContent = t; task.querySelector('.t').textContent = t; },
      focus() {
        if (win.minimized) { win.minimized = false; el.hidden = false; }
        el.style.zIndex = ++zTop;
        if (activeWin && activeWin !== win) { activeWin.el.classList.remove('active'); activeWin.task.classList.remove('active'); }
        activeWin = win; el.classList.add('active'); task.classList.add('active');
      },
      minimize() { win.minimized = true; el.hidden = true; el.classList.remove('active'); task.classList.remove('active'); if (activeWin === win) activeWin = null; },
      toggleMax() {
        if (!win.maximized) { win.restore = { l: el.style.left, t: el.style.top, w: el.style.width, h: el.style.height }; Object.assign(el.style, { left: '0px', top: '0px', width: '100%', height: 'calc(100% - 40px)' }); }
        else Object.assign(el.style, { left: win.restore.l, top: win.restore.t, width: win.restore.w, height: win.restore.h });
        win.maximized = !win.maximized; el.classList.toggle('maximized', win.maximized); maxB.textContent = win.maximized ? '❐' : '□';
      },
      close(force) {
        if (win.closed) return;
        if (!force && o.beforeClose && o.beforeClose() === false) return;
        win.closed = true;
        el.remove(); task.remove(); wins.delete(id);
        if (activeWin === win) { activeWin = null; const top = [...wins.values()].filter(w => !w.minimized).sort((a, b) => b.el.style.zIndex - a.el.style.zIndex)[0]; if (top) top.focus(); }
        win.onClose.forEach(f => { try { f(); } catch (e) { console.error(e); } });
      },
    };
    wins.set(id, win);
    el.addEventListener('pointerdown', () => win.focus(), true);
    minB.onclick = (e) => { e.stopPropagation(); win.minimize(); };
    maxB.onclick = (e) => { e.stopPropagation(); win.toggleMax(); };
    closeB.onclick = (e) => { e.stopPropagation(); win.close(); };
    task.onclick = () => { if (win.minimized || activeWin !== win) win.focus(); else win.minimize(); };
    bar.addEventListener('dblclick', (e) => { if (e.target.closest('button') || o.resizable === false) return; win.toggleMax(); });
    // drag
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button') || win.maximized) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, ox = el.offsetLeft, oy = el.offsetTop;
      const dsk = $('#desktop').getBoundingClientRect();
      const move = (ev) => {
        const nx = Math.max(-el.offsetWidth + 80, Math.min(dsk.width - 80, ox + ev.clientX - sx));
        const ny = Math.max(0, Math.min(dsk.height - 70, oy + ev.clientY - sy));
        el.style.left = nx + 'px'; el.style.top = ny + 'px';
      };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); document.body.style.cursor = ''; };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
    // resize
    el.querySelectorAll('.win-rs').forEach(hd => hd.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const d = hd.dataset.d, sx = e.clientX, sy = e.clientY, ow = el.offsetWidth, oh = el.offsetHeight, ox = el.offsetLeft;
      const minW = o.minWidth || 220, minH = o.minHeight || 140;
      const shield = h('div', { style: 'position:fixed;inset:0;z-index:99999;cursor:' + getComputedStyle(hd).cursor });
      document.body.append(shield);
      const move = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (d === 'r' || d === 'br') el.style.width = Math.max(minW, ow + dx) + 'px';
        if (d === 'b' || d === 'br') el.style.height = Math.max(minH, oh + dy) + 'px';
        if (d === 'l') { const nw = Math.max(minW, ow - dx); el.style.width = nw + 'px'; el.style.left = (ox + ow - nw) + 'px'; }
        OS.emit('resize:' + id);
      };
      const up = () => { shield.remove(); removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    }));
    layerEl().append(el);
    $('#tasks').append(task);
    setTimeout(() => el.classList.remove('opening'), 200);
    win.focus();
    return win;
  };
  OS.findWindow = (app) => [...wins.values()].find(w => w.app === app);

  // ------------------------------------------------------------------ Dialogs & toasts
  OS.toast = function (ico, msg, ms) {
    const t = h('div', { class: 'toast bevel' }, h('span', { style: 'font-size:18px', text: ico }), h('span', { text: msg }));
    $('#toasts').append(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, ms || 3200);
  };
  OS.dialog = function ({ title, icon, message, buttons, width }) {
    return new Promise((resolve) => {
      const w = OS.createWindow({ title: title || 'KampfOS', icon: icon || '💬', width: width || 400, height: 190, resizable: false });
      w.el.style.height = 'auto';
      const btns = h('div', { class: 'dialog-btns' });
      w.body.append(h('div', { class: 'dialog-body' }, h('div', { class: 'dico', text: icon || '💬' }), h('div', { class: 'dmsg', text: message })), btns);
      let done = false;
      (buttons || ['OK']).forEach((b, i) => {
        const bt = h('button', { class: 'btn' + (i === 0 ? ' primary' : ''), text: b, style: 'min-width:80px' });
        bt.onclick = () => { done = true; w.close(); resolve(b); };
        btns.append(bt); if (i === 0) setTimeout(() => bt.focus(), 30);
      });
      w.onClose.push(() => { if (!done) resolve(null); });
      // center
      requestAnimationFrame(() => { const d = $('#desktop'); w.el.style.left = Math.max(10, (d.clientWidth - w.el.offsetWidth) / 2) + 'px'; w.el.style.top = Math.max(10, (d.clientHeight - 40 - w.el.offsetHeight) / 2.4) + 'px'; });
    });
  };
  OS.brokeDialog = async function (msg) {
    const r = await OS.dialog({ title: 'INSUFFICIENT FUNDS', icon: '💸', message: (msg || 'The CPU refuses to work for free.') + '\n\nYour wallet: ' + state.coins + ' 🪙\nEarn coins with Coin Miner ⛏, TypeCorp jobs ⌨ or the Bounty Board 🎯.', buttons: ['Mine coins ⛏', 'Find a job ⌨', 'Cry'] });
    if (r === 'Mine coins ⛏') OS.openApp('miner'); else if (r === 'Find a job ⌨') OS.openApp('typing');
  };

  // ------------------------------------------------------------------ KampfScript runtime (processes)
  let procSeq = 0;
  const procs = new Set();
  OS.procs = procs;
  const UI_STYLES = new Set(['title', 'h1', 'h2', 'h3', 'p', 'small', 'muted', 'mono', 'bold', 'error', 'big', 'status', 'url', 'snippet', 'meta', 'logo', 'logo-small', 'grow', 'toolbar', 'searchbox', 'compact', 'gbtns', 'serp-head', 'results', 'result', 'result-title', 'article', 'li', 'pre', 'quote', 'errorpage', 'internal', 'cards', 'chip', 'calc-display', 'calc-row', 'calc-op', 'calc-eq']);
  const CSS_PROPS = { color: 1, background: 1, backgroundColor: 1, fontSize: 1, fontWeight: 1, fontFamily: 1, width: 1, height: 1, minHeight: 1, maxWidth: 1, padding: 1, margin: 1, textAlign: 1, flex: 1, border: 1, borderRadius: 1, gap: 1, justifyContent: 1, alignItems: 1, opacity: 1, lineHeight: 1 };

  function toK(v) {
    if (Array.isArray(v)) return v.map(toK);
    if (v && typeof v === 'object') { const m = new K.KMap(); for (const k of Object.keys(v)) m.m.set(k, toK(v[k])); return m; }
    return v === undefined ? null : v;
  }
  OS.toK = toK;

  /**
   * Run a KampfScript program.
   * opts: { name, path, out: {print(s,cls), input(prompt)->Promise, clear()}, onMeter(it), onExit(result) }
   */
  OS.runProgram = function (src, opts) {
    opts = opts || {};
    const name = opts.name || 'program';
    const proc = { id: ++procSeq, name, path: opts.path, windows: new Set(), timers: new Set(), mainDone: false, alive: true, out: opts.out || null, icon: opts.icon, interp: null, startedAt: Date.now() };
    const log = (s, cls) => { if (proc.out) proc.out.print(s, cls); else console.log('[' + name + ']', s); };
    const reportError = (e) => {
      const msg = e && e.message ? e.message : String(e);
      log('✖ ' + msg, 'c-err');
      if (e && e.code === K.OUT_OF_COINS) { OS.brokeDialog('💸 ' + name + ' ran out of coins mid-run!'); kill('Out of coins'); return; }
      if (!proc.out) OS.dialog({ title: name + ' crashed', icon: '🐞', message: msg, buttons: ['OK', 'Open source'] }).then(r => { if (r === 'Open source' && proc.path) OS.openApp('code', proc.path); });
      if (e && e.code === 'STEP_LIMIT' && proc.mainDone) { /* callback ran too long; keep app alive */ }
    };
    const interp = new K.Interpreter({
      maxSteps: Economy.maxSteps,
      stepsPerCoin: Economy.stepsPerCoin,
      runCost: Economy.runCost,
      onCharge: (n, reason) => Wallet.spend(n, (reason === 'run' ? 'Run ' : 'CPU ') + name),
      onPrint: (s) => log(s),
      onInput: (p) => proc.out && proc.out.input ? proc.out.input(p) : Promise.resolve(window.prompt(p) || ''),
      onMeter: (it) => opts.onMeter && opts.onMeter(it),
      onError: reportError,
      builtins: osBuiltins(proc),
    });
    proc.interp = interp;
    procs.add(proc);
    state.stats.runs++; save();
    function kill(reason) {
      if (!proc.alive) return;
      proc.alive = false; interp.stop();
      proc.timers.forEach(t => clearInterval(t)); proc.timers.clear();
      for (const w of [...proc.windows]) w.close(true);
      procs.delete(proc);
      if (opts.onMeter) opts.onMeter(interp);
      if (opts.onExit) opts.onExit({ steps: interp.totalSteps, coins: interp.coinsSpent, reason });
      OS.emit('procs');
    }
    proc.kill = kill;
    proc.maybeExit = () => { if (proc.mainDone && proc.windows.size === 0) kill('done'); };
    proc.done = (async () => {
      try {
        await interp.run(src);
        proc.mainDone = true;
        if (proc.windows.size && proc.out) log('· ' + name + ' is running in its window (' + proc.windows.size + ')', 'c-sys');
      } catch (e) {
        proc.mainDone = true;
        if (e && e.code === K.OUT_OF_COINS) { log('✖ ' + e.message, 'c-err'); OS.brokeDialog(); kill('Out of coins'); return; }
        reportError(e);
        kill('error');
        return;
      }
      proc.maybeExit();
    })();
    OS.emit('procs');
    return proc;
  };
  OS.runFile = function (path, extra) {
    const src = FS.read(path);
    if (src === null) { OS.toast('⚠️', 'File not found: ' + path); return null; }
    return OS.runProgram(src, Object.assign({ name: path.split('/').pop().replace(/\.ks$/, ''), path }, extra || {}));
  };

  function osBuiltins(proc) {
    const { KError, KHandle, KMap } = K;
    const B = (fn, min, max) => ({ fn, min, max });
    const el = (v, nm, kinds) => {
      if (!(v instanceof KHandle) || (kinds && !kinds.includes(v.kind))) throw new KError(nm + ' needs a UI element' + (kinds ? ' (' + kinds.join('/') + ')' : '') + ', got ' + K.typeOf(v));
      return v;
    };
    const container = (v, nm) => { const x = el(v, nm); if (x.kind === 'window') return x.content; if (!x.el.classList.contains('ks-container')) throw new KError(nm + ': you can only put things inside a window, row, col, scroll, center or flow'); return x.el; };
    const alive = () => { if (!proc.alive) throw new KError('Program has ended.'); };
    // UI callbacks run one at a time, in order (like a real event loop)
    proc.queue = Promise.resolve(); proc.pending = 0;
    const enqueue = (fn, args) => { proc.pending++; proc.queue = proc.queue.then(() => proc.alive ? proc.interp.invoke(fn, args) : null).catch(e => console.error(e)).finally(() => proc.pending--); return proc.queue; };
    const cb = (fn) => (...args) => { if (proc.alive && fn) enqueue(fn, args.map(toK)); };
    const isFn = (f) => f instanceof K.KFunc || f instanceof K.KBuiltin;
    const make = (kind, tag, cls, parent, nm) => { alive(); const p = container(parent, nm); const e = h(tag, { class: cls }); p.append(e); return new KHandle(kind, e); };
    const styleOk = (s) => { if (s && !UI_STYLES.has(s)) throw new KError("Unknown style '" + s + "'. Try: " + [...UI_STYLES].slice(0, 12).join(', ') + ' …'); return s; };
    const needUpgrade = (id, what) => { if (!has(id)) throw new KError(what + ' needs the ' + SHOP.find(x => x.id === id).name + ' upgrade. Buy it in the Shop 🛒'); };
    const canvasOf = (c, nm) => { el(c, nm, ['canvas']); return c.ctx; };
    const netCall = async (path, cost, label) => {
      if (!has('netcard')) return { ok: false, error: 'No Network Card installed! Buy the Network Card in the Shop 🛒 (40 coins) to go online.' };
      if (!Wallet.spend(cost, label)) return { ok: false, error: 'Not enough coins! This costs ' + cost + ' 🪙 and your wallet has ' + state.coins + '. Mine some coins first.' };
      try {
        const r = await fetch(PROXY + path);
        const d = await r.json();
        return d;
      } catch (e) { return { ok: false, error: 'Network error: could not reach the KampfOS proxy (' + e.message + ')' }; }
    };
    return {
      window: B(([title, w, hh]) => {
        alive();
        const win = OS.createWindow({ title: K.show(title === undefined ? proc.name : title), icon: proc.icon || '🧾', width: typeof w === 'number' ? w + 16 : 420, height: typeof hh === 'number' ? hh + 40 : 320, app: 'ks:' + proc.id });
        const content = h('div', { class: 'ks-root ks-container' });
        win.body.append(content);
        proc.windows.add(win);
        const handle = new KHandle('window', win.el, { content, win, closeCbs: [] });
        win.onClose.push(() => { proc.windows.delete(win); handle.closeCbs.forEach(f => f()); proc.maybeExit(); });
        return handle;
      }, 0, 3),
      on_close: B(([w, f]) => { el(w, 'on_close()', ['window']).closeCbs.push(cb(f)); return null; }, 2, 2),
      settitle: B(([w, t]) => { el(w, 'settitle()', ['window']).win.setTitle(K.show(t)); return null; }, 2, 2),
      close: B(([w]) => { el(w, 'close()', ['window']).win.close(); return null; }, 1, 1),
      row: B(([p]) => make('row', 'div', 'ks-row ks-container', p, 'row()'), 1, 1),
      col: B(([p]) => make('col', 'div', 'ks-col ks-container', p, 'col()'), 1, 1),
      scroll: B(([p]) => make('scroll', 'div', 'ks-scroll ks-container', p, 'scroll()'), 1, 1),
      center: B(([p]) => make('center', 'div', 'ks-center ks-container', p, 'center()'), 1, 1),
      flow: B(([p]) => make('flow', 'div', 'ks-flow ks-container', p, 'flow()'), 1, 1),
      label: B(([p, t, s]) => { const x = make('label', 'div', 'ks-label', p, 'label()'); x.el.textContent = K.show(t); if (s) x.el.classList.add(styleOk(K.show(s))); return x; }, 2, 3),
      text: B(([p, t]) => { const x = make('text', 'span', 'ks-text', p, 'text()'); x.el.textContent = K.show(t); return x; }, 2, 2),
      link: B(([p, t, f, s]) => { const x = make('link', 'a', 'ks-link', p, 'link()'); x.el.textContent = K.show(t); x.el.tabIndex = 0; if (s) x.el.classList.add(styleOk(K.show(s))); if (isFn(f)) x.el.addEventListener('click', (e) => { e.preventDefault(); cb(f)(); }); return x; }, 2, 4),
      button: B(([p, t, f, s]) => { const x = make('button', 'button', 'ks-button', p, 'button()'); x.el.textContent = K.show(t); if (s) x.el.classList.add(styleOk(K.show(s))); if (isFn(f)) x.el.addEventListener('click', () => cb(f)()); return x; }, 2, 4),
      textbox: B(([p, ph, f]) => {
        const x = make('textbox', 'input', 'ks-textbox', p, 'textbox()'); x.el.type = 'text'; x.el.spellcheck = false;
        if (ph) x.el.placeholder = K.show(ph);
        if (isFn(f)) x.el.addEventListener('keydown', (e) => { if (e.key === 'Enter') cb(f)(x.el.value); });
        return x;
      }, 1, 3),
      image: B(([p, url]) => {
        const x = make('image', 'img', 'ks-image', p, 'image()'); const u = K.show(url);
        if (!/^https?:\/\//.test(u)) throw new KError('image() needs an http(s) URL');
        x.el.src = u; x.el.loading = 'lazy'; x.el.referrerPolicy = 'no-referrer'; x.el.onerror = () => x.el.remove(); return x;
      }, 2, 2),
      hr: B(([p]) => make('hr', 'hr', 'ks-hr', p, 'hr()'), 1, 1),
      spacer: B(([p, px]) => { const x = make('spacer', 'div', '', p, 'spacer()'); x.el.style.height = (typeof px === 'number' ? px : 10) + 'px'; return x; }, 1, 2),
      settext: B(([x, t]) => { el(x, 'settext()'); if (x.kind === 'textbox') x.el.value = K.show(t); else if (x.kind === 'window') x.win.setTitle(K.show(t)); else x.el.textContent = K.show(t); return null; }, 2, 2),
      gettext: B(([x]) => { el(x, 'gettext()'); return x.kind === 'textbox' ? x.el.value : x.kind === 'window' ? x.win.el.querySelector('.wt-text').textContent : x.el.textContent; }, 1, 1),
      clear: B(([x]) => { const c = container(x, 'clear()'); c.replaceChildren(); if (c.scrollTop) c.scrollTop = 0; c.scrollTop = 0; return null; }, 1, 1),
      remove: B(([x]) => { el(x, 'remove()'); if (x.kind === 'window') x.win.close(); else x.el.remove(); return null; }, 1, 1),
      focus: B(([x]) => { el(x, 'focus()'); setTimeout(() => x.el.focus(), 30); return null; }, 1, 1),
      enable: B(([x, on]) => { el(x, 'enable()'); x.el.disabled = !K.truthy(on); return null; }, 2, 2),
      addstyle: B(([x, s]) => { el(x, 'addstyle()'); (x.kind === 'window' ? x.content : x.el).classList.add(styleOk(K.show(s))); return null; }, 2, 2),
      setstyle: B(([x, prop, val]) => {
        el(x, 'setstyle()'); const p = K.show(prop);
        if (!CSS_PROPS[p]) throw new KError("setstyle(): '" + p + "' is not allowed. Allowed: " + Object.keys(CSS_PROPS).join(', '));
        const v = K.show(val); if (/url\(|expression|javascript:/i.test(v)) throw new KError('setstyle(): that value is not allowed');
        (x.kind === 'window' ? x.content : x.el).style[p] = typeof val === 'number' && !['opacity', 'flex', 'fontWeight', 'lineHeight'].includes(p) ? val + 'px' : v; return null;
      }, 3, 3),
      on_click: B(([x, f]) => {
        el(x, 'on_click()');
        const fire = cb(f);
        x.el.style.cursor = 'pointer';
        x.el.addEventListener('click', (e) => { if (x.kind === 'canvas') { const r = x.el.getBoundingClientRect(); fire(Math.round((e.clientX - r.left) * x.el.width / r.width), Math.round((e.clientY - r.top) * x.el.height / r.height)); } else fire(); });
        return null;
      }, 2, 2),
      alert: B(async ([m]) => { await OS.dialog({ title: proc.name, icon: 'ℹ️', message: K.show(m) }); return null; }, 1, 1),
      // ---- graphics (GPU)
      canvas: B(([p, w, hh]) => {
        needUpgrade('gpu', 'canvas()');
        const x = make('canvas', 'canvas', 'ks-canvas', p, 'canvas()');
        x.el.width = Math.max(10, Math.min(1600, typeof w === 'number' ? w : 300)); x.el.height = Math.max(10, Math.min(1200, typeof hh === 'number' ? hh : 200));
        x.ctx = x.el.getContext('2d'); return x;
      }, 1, 3),
      clear_canvas: B(([c, col]) => { const g = canvasOf(c, 'clear_canvas()'); if (col) { g.fillStyle = K.show(col); g.fillRect(0, 0, c.el.width, c.el.height); } else g.clearRect(0, 0, c.el.width, c.el.height); return null; }, 1, 2),
      fill_rect: B(([c, x, y, w, hh, col]) => { const g = canvasOf(c, 'fill_rect()'); g.fillStyle = K.show(col || '#000'); g.fillRect(x, y, w, hh); return null; }, 5, 6),
      circle: B(([c, x, y, r, col]) => { const g = canvasOf(c, 'circle()'); g.fillStyle = K.show(col || '#000'); g.beginPath(); g.arc(x, y, Math.max(0, r), 0, Math.PI * 2); g.fill(); return null; }, 4, 5),
      line: B(([c, x1, y1, x2, y2, col, w]) => { const g = canvasOf(c, 'line()'); g.strokeStyle = K.show(col || '#000'); g.lineWidth = w || 2; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); return null; }, 5, 7),
      draw_text: B(([c, x, y, t, col, size]) => { const g = canvasOf(c, 'draw_text()'); g.fillStyle = K.show(col || '#000'); g.font = (size || 14) + 'px "Segoe UI", sans-serif'; g.fillText(K.show(t), x, y); return null; }, 4, 6),
      every: B(([ms, f]) => {
        alive(); if (typeof ms !== 'number') throw new KError('every() needs milliseconds');
                const t = setInterval(() => { if (!proc.alive || proc.pending > 0) return; enqueue(f, []); }, Math.max(16, ms));
        proc.timers.add(t); return new KHandle('timer', null, { t });
      }, 2, 2),
      stop: B(([t]) => { el(t, 'stop()', ['timer']); clearInterval(t.t); proc.timers.delete(t.t); return null; }, 1, 1),
      // ---- network (Network Card)
      fetch: B(async ([url]) => {
        let u = K.show(url).trim();
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
        const d = await netCall('/read?url=' + encodeURIComponent(u), Economy.pageCost, 'Web: ' + u.replace(/^https?:\/\//, '').slice(0, 40));
        if (!d.ok && !d.error) d.error = 'Unknown error';
        if (!d.blocks) d.blocks = []; if (!d.title) d.title = u; if (!d.url) d.url = u; if (d.error === undefined) d.error = '';
        return toK(d);
      }, 1, 1),
      search: B(async ([q]) => {
        const query = K.show(q).trim();
        if (!query) return toK({ ok: false, error: 'Empty search', results: [] });
        const d = await netCall('/search?q=' + encodeURIComponent(query), Economy.searchCost, 'Kugel search');
        if (!d.results) d.results = [];
        if (d.ok && !d.results.length) { d.ok = true; }
        if (!d.engine) d.engine = 'none'; if (d.error === undefined) d.error = '';
        return toK(d);
      }, 1, 1),
      // ---- economy
      pay: B(([n, why]) => { if (typeof n !== 'number' || n < 0) throw new KError('pay() needs a positive number'); return Wallet.spend(Math.ceil(n), why ? K.show(why) : proc.name); }, 1, 2),
      coins: B(() => state.coins, 0, 0),
      has_upgrade: B(([id]) => has(K.show(id)), 1, 1),
      open_app: B(([name]) => { const n = K.show(name); if (n.startsWith('code:')) OS.openApp('code', n.slice(5)); else OS.openApp(n); return null; }, 1, 1),
      // ---- files
      read_file: B(([p]) => FS.read(K.show(p)), 1, 1),
      write_file: B(([p, t]) => { FS.write(K.show(p), K.show(t)); return true; }, 2, 2),
      list_files: B(([p]) => FS.list(p ? K.show(p) : '/'), 0, 1),
    };
  }

  OS.UI_BUILTINS = ['window', 'on_close', 'settitle', 'close', 'row', 'col', 'scroll', 'center', 'flow', 'label', 'text', 'link', 'button', 'textbox', 'image', 'hr', 'spacer', 'settext', 'gettext', 'clear', 'remove', 'focus', 'enable', 'addstyle', 'setstyle', 'on_click', 'alert', 'canvas', 'clear_canvas', 'fill_rect', 'circle', 'line', 'draw_text', 'every', 'stop', 'fetch', 'search', 'pay', 'coins', 'has_upgrade', 'open_app', 'read_file', 'write_file', 'list_files'];
})();
