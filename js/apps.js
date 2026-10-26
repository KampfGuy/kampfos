/* KampfOS apps + desktop shell */
(function () {
  'use strict';
  const { h, $, state, save, Wallet, Economy, FS, K } = OS;
  const VERSION = window.KAMPFOS_VERSION || '1';
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ================================================================ Syntax highlighter
  const BUILTIN_NAMES = new Set(Object.keys(new K.Interpreter().globals.vars).concat(OS.UI_BUILTINS));
  function highlight(src, errLine) {
    const re = /(#[^\n]*|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|\+=|-=|\*=|\/=|[+\-*/%<>=!])|(\n)|([^\n])/g;
    let out = '', m, line = 1;
    const open = () => errLine === line ? '<span class="ed-line-err">' : '';
    const close = () => errLine === line ? '</span>' : '';
    out += open();
    while ((m = re.exec(src))) {
      if (m[1]) out += '<span class="tk-com">' + esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="tk-str">' + esc(m[2]) + '</span>';
      else if (m[3]) out += '<span class="tk-num">' + m[3] + '</span>';
      else if (m[4]) {
        const w = m[4];
        if (w === 'true' || w === 'false' || w === 'nil') out += '<span class="tk-bool">' + w + '</span>';
        else if (K.KEYWORDS.has(w)) out += '<span class="tk-kw">' + w + '</span>';
        else if (BUILTIN_NAMES.has(w) || src[re.lastIndex] === '(') out += '<span class="tk-fn">' + w + '</span>';
        else out += w;
      } else if (m[5]) out += '<span class="tk-op">' + esc(m[5]) + '</span>';
      else if (m[6]) { out += close() + '\n'; line++; out += open(); }
      else out += esc(m[7]);
    }
    return out + close() + '\n ';
  }

  // ================================================================ Console widget
  function makeConsole(el) {
    return {
      el,
      print(s, cls) {
        const d = h('div', { class: cls || '' }); d.textContent = s; el.append(d);
        while (el.childNodes.length > 1500) el.firstChild.remove();
        el.scrollTop = el.scrollHeight;
      },
      clear() { el.replaceChildren(); },
      input(prompt) {
        return new Promise((resolve) => {
          const inp = h('input', { spellcheck: 'false' });
          const row = h('div', { class: 'c-input c-in' }, h('span', { text: (prompt || '') + ' ›' }), inp);
          el.append(row); el.scrollTop = el.scrollHeight; setTimeout(() => inp.focus(), 20);
          inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = inp.value; row.replaceWith(h('div', { class: 'c-in', text: (prompt || '') + ' › ' + v })); resolve(v); } });
        });
      },
    };
  }

  // ================================================================ KampfCode editor
  function openEditor(path) {
    const w = OS.createWindow({ title: 'KampfCode', icon: '📝', width: 720, height: 560, app: 'code', minWidth: 420, minHeight: 300 });
    let curPath = null, dirty = false, proc = null, errLine = null;
    const ta = h('textarea', { spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', wrap: 'off' });
    const pre = h('pre');
    const gutter = h('div', { class: 'ed-gutter' });
    const area = h('div', { class: 'ed-area' }, pre, ta);
    const conEl = h('div', { class: 'console' });
    const con = makeConsole(conEl);
    const runB = h('button', { class: 'btn run-btn', title: 'Run (Ctrl+Enter)' }, '▶ Run ', h('span', { class: 'cost-pill rc' }));
    const stopB = h('button', { class: 'btn stop-btn', text: '■ Stop', disabled: true });
    const exSel = h('select', { class: 'field', style: 'height:26px' }, h('option', { value: '', text: 'Examples…' }), ...FS.list('/examples/').map(p => h('option', { value: p, text: p.split('/').pop() })), h('option', { value: '/system/kompass.ks', text: '🧭 kompass.ks (browser)' }), h('option', { value: '/system/coincalc.ks', text: '💸 coincalc.ks' }));
    const tb = h('div', { class: 'toolbar' },
      h('button', { class: 'btn', text: '📄 New', onclick: () => confirmDiscard().then(ok => ok && load(null, '# New KampfScript program\n\nprint("Hello!")\n')) }),
      h('button', { class: 'btn', text: '📂 Open', onclick: () => pickFile() }),
      h('button', { class: 'btn', text: '💾 Save', onclick: () => doSave() }),
      h('div', { class: 'sep' }), runB, stopB, h('div', { class: 'sep' }), exSel,
      h('button', { class: 'btn', text: '📘 Docs', onclick: () => OS.openApp('docs') }),
      h('button', { class: 'btn', text: '🧹', title: 'Clear console', onclick: () => con.clear() }));
    const sFile = h('span', { class: 'grow' }), sPos = h('span'), sMeter = h('span', { class: 'meter' }), sCost = h('span');
    const meterBar = h('i');
    sMeter.append(h('span', { class: 'mt', text: 'Steps 0' }), h('span', { class: 'bar' }, meterBar), h('span', { class: 'ms', text: '0 🪙' }));
    const status = h('div', { class: 'statusbar' }, sFile, sPos, sMeter, sCost);
    const split = h('div', { class: 'ed-split', title: 'Drag to resize console' });
    w.body.append(tb, h('div', { class: 'ed-wrap' }, gutter, area), split, conEl, status);

    function refresh() {
      pre.innerHTML = highlight(ta.value, errLine);
      const n = ta.value.split('\n').length;
      let g = ''; for (let i = 1; i <= n; i++) g += (i === errLine ? '<span class="err">' + i + '</span>' : i) + '\n';
      gutter.innerHTML = g + ' ';
      syncScroll();
    }
    function syncScroll() { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop; }
    function updatePos() { const before = ta.value.slice(0, ta.selectionStart).split('\n'); sPos.textContent = 'Ln ' + before.length + ', Col ' + (before[before.length - 1].length + 1); }
    function updateCost() {
      runB.querySelector('.rc').textContent = Economy.runCost + ' 🪙';
      sCost.textContent = 'Run ' + Economy.runCost + '🪙 + 1🪙/' + fmt(Economy.stepsPerCoin) + ' steps · limit ' + fmt(Economy.maxSteps);
    }
    function setTitle() { w.setTitle((dirty ? '● ' : '') + (curPath ? curPath.split('/').pop() : 'untitled.ks') + ' — KampfCode'); sFile.textContent = curPath || '(unsaved)'; }
    function load(p, text) { curPath = p; ta.value = text !== undefined ? text : (FS.read(p) || ''); dirty = false; errLine = null; setTitle(); refresh(); ta.scrollTop = 0; }
    function confirmDiscard() { if (!dirty) return Promise.resolve(true); return OS.dialog({ title: 'Unsaved changes', icon: '⚠️', message: 'Discard your unsaved changes?', buttons: ['Discard', 'Cancel'] }).then(r => r === 'Discard'); }
    async function doSave(as) {
      let p = curPath;
      if (!p || as) { p = window.prompt('Save as (path):', curPath || '/home/my_program.ks'); if (!p) return false; }
      try { curPath = FS.write(p, ta.value); dirty = false; setTitle(); OS.toast('💾', 'Saved ' + curPath); return true; } catch (e) { OS.toast('⚠️', e.message); return false; }
    }
    function pickFile() {
      const pw = OS.createWindow({ title: 'Open file', icon: '📂', width: 360, height: 380 });
      const list = h('div', { class: 'files-list sunken' });
      FS.list('/').forEach(p => list.append(h('div', { class: 'fr', text: '📄 ' + p, ondblclick: () => confirmDiscard().then(ok => { if (ok) { load(p); pw.close(); } }) })));
      pw.body.append(h('div', { style: 'padding:4px 6px;font-size:12px', text: 'Double-click a file to open it.' }), list);
    }
    async function run() {
      if (proc) return;
      errLine = null; refresh();
      if (Wallet.coins < Economy.runCost) { con.print('✖ 💸 You need ' + Economy.runCost + ' 🪙 to start a program but you only have ' + Wallet.coins + '. The CPU refuses to work for free.', 'c-err'); OS.brokeDialog(); return; }
      try { K.parse(ta.value); } catch (e) { errLine = e.line || null; refresh(); con.print('✖ Syntax error — ' + e.message, 'c-err'); return; }
      con.print('▶ Running ' + (curPath || 'untitled.ks') + '  (−' + Economy.runCost + ' 🪙)', 'c-sys');
      runB.disabled = true; stopB.disabled = false;
      const t0 = performance.now();
      proc = OS.runProgram(ta.value, {
        name: curPath ? curPath.split('/').pop().replace(/\.ks$/, '') : 'untitled', path: curPath, out: {
          print: (s, cls) => { con.print(s, cls); if (cls === 'c-err') { const m = /^✖ Line (\d+):/.exec(s); if (m) { errLine = +m[1]; refresh(); } } },
          input: (p) => con.input(p),
        },
        onMeter: (it) => {
          sMeter.querySelector('.mt').textContent = 'Steps ' + fmt(it.totalSteps);
          sMeter.querySelector('.ms').textContent = it.coinsSpent + ' 🪙';
          meterBar.style.width = Math.min(100, it.steps / it.maxSteps * 100) + '%';
        },
        onExit: (r) => {
          const ms = Math.round(performance.now() - t0);
          con.print('■ Finished: ' + fmt(r.steps) + ' steps · cost ' + r.coins + ' 🪙 · ' + ms + ' ms' + (r.reason && r.reason !== 'done' ? ' · ' + r.reason : ''), r.reason === 'done' ? 'c-ok' : 'c-sys');
          proc = null; runB.disabled = false; stopB.disabled = true;
        },
      });
    }
    runB.onclick = run;
    stopB.onclick = () => { if (proc) proc.kill('stopped by you'); };
    exSel.onchange = () => { const p = exSel.value; exSel.value = ''; if (p) confirmDiscard().then(ok => ok && load(p)); };
    ta.addEventListener('input', () => { if (!dirty) { dirty = true; setTitle(); } errLine = null; refresh(); updatePos(); });
    ta.addEventListener('scroll', syncScroll);
    ta.addEventListener('click', updatePos); ta.addEventListener('keyup', updatePos);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
      else if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSave(); }
      else if (e.key === 'Enter') {
        const before = ta.value.slice(0, ta.selectionStart); const line = before.split('\n').pop();
        let ind = line.match(/^\s*/)[0]; if (/\{\s*$/.test(line)) ind += '  ';
        e.preventDefault(); document.execCommand('insertText', false, '\n' + ind);
      }
    });
    split.addEventListener('pointerdown', (e) => {
      e.preventDefault(); const sy = e.clientY, oh = conEl.offsetHeight;
      const mv = (ev) => { conEl.style.flex = '0 0 ' + Math.max(50, Math.min(w.body.offsetHeight - 120, oh - (ev.clientY - sy))) + 'px'; };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    });
    const off = [OS.on('upgrades', updateCost)];
    w.onClose.push(() => { off.forEach(f => f()); if (proc) proc.kill('editor closed'); });
    load(path || '/examples/hello.ks');
    updateCost(); updatePos();
    con.print('KampfScript console ready. Press ▶ Run or Ctrl+Enter.', 'c-sys');
    setTimeout(() => ta.focus(), 50);
    w.editor = { load, run, get path() { return curPath; } };
    return w;
  }

  // ================================================================ Coin Miner
  function openMiner() {
    const w = OS.createWindow({ title: 'Coin Miner', icon: '⛏️', width: 340, height: 380, app: 'miner' });
    const total = h('div', { class: 'big', text: '' });
    const rate = h('div', { style: 'font-size:12px;opacity:.8' });
    const rock = h('div', { class: 'rock', text: '🪨', title: 'Click to mine!' });
    const box = h('div', { class: 'miner' }, h('div', { class: 'big', text: 'COIN MINER' }), rock, total, rate);
    w.body.append(box);
    let clicksThisSec = 0, mined = 0;
    const tick = setInterval(() => { clicksThisSec = 0; }, 1000);
    const upd = () => { total.textContent = 'Mined this session: ' + mined; rate.textContent = '+' + Economy.clickValue + ' 🪙 per click' + (Economy.has('automine') ? ' · Auto-Miner running 🤖' : '') + ' · Wallet ' + fmt(state.coins); };
    rock.addEventListener('pointerdown', (e) => {
      if (++clicksThisSec > 14) { rock.textContent = '🥵'; setTimeout(() => rock.textContent = '🪨', 400); return; }
      const v = Economy.clickValue; mined += v; state.stats.clicks++;
      Wallet.add(v, 'Coin Miner', e); upd();
      rock.textContent = Math.random() < .5 ? '🪨' : '🗿';
      if (Math.random() < 0.02 && !box.querySelector('.nugget')) {
        const n = h('div', { class: 'nugget', text: '💎', style: `left:${20 + Math.random() * 240}px;top:${30 + Math.random() * 220}px` });
        n.onclick = (ev) => { Wallet.add(25, 'Lucky diamond', ev); mined += 25; n.remove(); upd(); };
        box.append(n); setTimeout(() => n.remove(), 2500);
      }
    });
    const off = Wallet.onChange(upd);
    w.onClose.push(() => { clearInterval(tick); off(); });
    upd();
    return w;
  }

  // ================================================================ TypeCorp typing job
  const PHRASES = [
    'the quick brown fox jumps over the lazy dog',
    'print("hello world") costs three coins on kampfos',
    'let coins = coins + 1',
    'for i in range(10) { print(i) }',
    'every program must pay the cpu tax',
    'kugel is like google but way simpler',
    'fn add(a, b) { return a + b }',
    'my boss says typing faster earns more coins',
    'kompass is a browser written in kampfscript',
    'while true { mine_coins() }',
    'the calculator charges one coin per answer',
    'debugging is like being a detective in a crime movie where you are also the murderer',
  ];
  function openTyping() {
    const w = OS.createWindow({ title: 'TypeCorp — Data Entry Job', icon: '⌨️', width: 520, height: 330, app: 'typing' });
    const phraseEl = h('div', { class: 'phrase sunken' });
    const ta = h('textarea', { class: 'sunken', spellcheck: 'false', placeholder: 'Start typing the text above… press Enter to submit' });
    const info = h('div', { style: 'font-size:12px' });
    const result = h('div', { style: 'font-weight:700;min-height:18px' });
    w.body.append(h('div', { class: 'typing' }, h('div', { html: '<b>TypeCorp™</b> pays you to type. Faster + more accurate = more coins (max 25 🪙 per task).' }), phraseEl, ta, info, result));
    let phrase = '', start = 0;
    function newTask() { phrase = PHRASES[Math.floor(Math.random() * PHRASES.length)]; ta.value = ''; start = 0; render(); ta.disabled = false; ta.focus(); info.textContent = 'Jobs done: ' + state.stats.jobs; }
    function render() {
      const v = ta.value; let out = '';
      for (let i = 0; i < phrase.length; i++) {
        const c = esc(phrase[i]);
        if (i < v.length) out += '<span class="' + (v[i] === phrase[i] ? 'ok' : 'bad') + '">' + c + '</span>';
        else if (i === v.length) out += '<span class="cur">' + c + '</span>'; else out += c;
      }
      phraseEl.innerHTML = out;
    }
    function submit() {
      const v = ta.value.trim(); if (!v) return;
      const secs = Math.max(1, (Date.now() - start) / 1000);
      let correct = 0; for (let i = 0; i < phrase.length; i++) if (v[i] === phrase[i]) correct++;
      const acc = correct / Math.max(phrase.length, v.length);
      const wpm = (v.length / 5) / (secs / 60);
      let pay = Math.round((phrase.length / 5) * acc * acc * Math.min(2, wpm / 30));
      pay = Math.max(0, Math.min(25, pay));
      if (acc < 0.6) pay = 0;
      ta.disabled = true;
      if (pay > 0) { Wallet.add(pay, 'TypeCorp job', ta); state.stats.jobs++; save(); }
      result.textContent = (pay > 0 ? '✅ Paid ' + pay + ' 🪙' : '❌ Too many typos — no pay') + '  ·  ' + Math.round(acc * 100) + '% accuracy · ' + Math.round(wpm) + ' WPM';
      setTimeout(newTask, 1400);
    }
    ta.addEventListener('input', () => { if (!start) start = Date.now(); render(); if (ta.value.length >= phrase.length && ta.value === phrase) submit(); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    ta.addEventListener('paste', (e) => { e.preventDefault(); result.textContent = '🚫 No pasting! TypeCorp is watching.'; });
    newTask();
    return w;
  }

  // ================================================================ Bounty board (coding challenges)
  const BOUNTIES = [
    { id: 'hello', title: 'Hello, KampfOS', reward: 10, desc: 'Print exactly <code>Hello, KampfOS!</code>', starter: '# print the greeting\n', expect: ['Hello, KampfOS!'] },
    { id: 'count', title: 'Count to 5', reward: 15, desc: 'Print the numbers 1 to 5, one per line. Use a loop!', starter: 'for i in range(1, 6) {\n  \n}\n', expect: ['1', '2', '3', '4', '5'], needs: /\b(for|while)\b/ },
    { id: 'sum', title: 'Sum 1 to 100', reward: 20, desc: 'Use a loop to add up every number from 1 to 100, then print the total.', starter: 'let total = 0\n', expect: ['5050'], needs: /\b(for|while)\b/ },
    { id: 'square', title: 'Squares', reward: 25, desc: 'Write a function <code>square(n)</code> that returns <code>n * n</code>. We will test it with a few numbers.', starter: 'fn square(n) {\n  \n}\n', tests: [['square', [3], 9], ['square', [12], 144], ['square', [-4], 16]] },
    { id: 'fizz', title: 'FizzBuzz', reward: 40, desc: 'Print 1 to 15, but <code>Fizz</code> for multiples of 3, <code>Buzz</code> for multiples of 5 and <code>FizzBuzz</code> for both.', starter: 'for n in range(1, 16) {\n  \n}\n', expect: ['1', '2', 'Fizz', '4', 'Buzz', 'Fizz', '7', '8', 'Fizz', 'Buzz', '11', 'Fizz', '13', '14', 'FizzBuzz'] },
    { id: 'rev', title: 'Backwards', reward: 30, desc: 'Write <code>rev(s)</code> that returns the string reversed — without using <code>reverse()</code>. Hint: loop over the characters.', starter: 'fn rev(s) {\n  let out = ""\n  \n  return out\n}\n', tests: [['rev', ['kampf'], 'fpmak'], ['rev', ['abc'], 'cba'], ['rev', [''], '']], banned: /\breverse\s*\(/ },
    { id: 'biggest', title: 'Biggest number', reward: 30, desc: 'Write <code>biggest(xs)</code> returning the largest number in a list — without <code>max()</code> or <code>sort()</code>.', starter: 'fn biggest(xs) {\n  \n}\n', tests: [['biggest', [[3, 9, 2]], 9], ['biggest', [[-5, -2, -9]], -2], ['biggest', [[7]], 7]], banned: /\b(max|sort)\s*\(/ },
    { id: 'fib', title: 'Fibonacci', reward: 50, desc: 'Write <code>fib(n)</code>: fib(0)=0, fib(1)=1, fib(n)=fib(n-1)+fib(n-2).', starter: 'fn fib(n) {\n  \n}\n', tests: [['fib', [0], 0], ['fib', [1], 1], ['fib', [10], 55], ['fib', [20], 6765]] },
    { id: 'vowels', title: 'Vowel counter', reward: 35, desc: 'Write <code>vowels(s)</code> that counts a, e, i, o, u (lower or upper case).', starter: 'fn vowels(s) {\n  \n}\n', tests: [['vowels', ['KampfOS'], 2], ['vowels', ['hello world'], 3], ['vowels', ['xyz'], 0]] },
  ];
  function openBounty() {
    const w = OS.createWindow({ title: 'Bounty Board — coding challenges', icon: '🎯', width: 720, height: 480, app: 'bounty' });
    const list = h('div', { class: 'blist sunken' });
    const desc = h('div', { class: 'bdesc sunken' });
    const ta = h('textarea', { spellcheck: 'false', wrap: 'off' });
    const outEl = h('div', { class: 'console bout' });
    const con = makeConsole(outEl);
    const submitB = h('button', { class: 'btn gold primary', text: '🎯 Submit solution (free to run)' });
    w.body.append(h('div', { class: 'bounty' }, list, h('div', { class: 'bmain' }, desc, ta, h('div', { class: 'toolbar' }, submitB, h('span', { style: 'font-size:12px', text: 'Bounty runs are free. Each bounty pays once.' })), outEl)));
    let cur = null; const drafts = {};
    function renderList() {
      list.replaceChildren(...BOUNTIES.map(b => h('div', { class: 'bitem' + (cur === b ? ' on' : ''), onclick: () => select(b) }, h('span', { text: (state.bounties[b.id] ? '✅ ' : '🎯 ') + b.title }), h('span', { class: 'rw', text: state.bounties[b.id] ? 'paid' : b.reward + ' 🪙' }))));
    }
    function select(b) {
      if (cur) drafts[cur.id] = ta.value;
      cur = b; renderList();
      desc.innerHTML = '<b>' + esc(b.title) + '</b> — reward <b>' + b.reward + ' 🪙</b>' + (state.bounties[b.id] ? ' (already claimed)' : '') + '<br>' + b.desc;
      ta.value = drafts[b.id] || b.starter; con.clear();
    }
    submitB.onclick = async () => {
      const b = cur; const src = ta.value; con.clear();
      if (b.banned && b.banned.test(src)) { con.print('✖ Nice try! That built-in is banned for this bounty.', 'c-err'); return; }
      if (b.needs && !b.needs.test(src)) { con.print('✖ This bounty requires a loop (for / while).', 'c-err'); return; }
      const out = [];
      const it = new K.Interpreter({ maxSteps: 200000, onPrint: s => { out.push(s); con.print(s); }, onInput: async () => '' });
      try {
        await it.run(src);
        let ok = true;
        if (b.expect) {
          ok = out.length === b.expect.length && out.every((s, i) => s.trim() === b.expect[i]);
          if (!ok) con.print('✖ Expected output:\n' + b.expect.join('\n'), 'c-err');
        }
        if (b.tests) for (const [fname, args, want] of b.tests) {
          let fn; try { fn = it.globals.get(fname); } catch { con.print('✖ You need to define a function called ' + fname + '()', 'c-err'); ok = false; break; }
          it.steps = 0;
          const got = await it.callValue(fn, args.map(a => Array.isArray(a) ? a.slice() : a), 0);
          const pass = K.show(got, true) === K.show(want, true);
          con.print((pass ? '✔ ' : '✖ ') + fname + '(' + args.map(a => K.show(a, true)).join(', ') + ') = ' + K.show(got, true) + (pass ? '' : '  (expected ' + K.show(want, true) + ')'), pass ? 'c-ok' : 'c-err');
          if (!pass) ok = false;
        }
        if (ok) {
          if (!state.bounties[b.id]) { state.bounties[b.id] = Date.now(); save(); Wallet.add(b.reward, 'Bounty: ' + b.title, submitB); con.print('🎉 Bounty complete! +' + b.reward + ' 🪙', 'c-ok'); OS.toast('🎯', 'Bounty complete: +' + b.reward + ' 🪙'); }
          else con.print('🎉 Correct! (You already claimed this bounty.)', 'c-ok');
          renderList();
        }
      } catch (e) { con.print('✖ ' + e.message, 'c-err'); }
    };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); } });
    select(BOUNTIES.find(b => !state.bounties[b.id]) || BOUNTIES[0]);
    return w;
  }

  // ================================================================ Shop
  function openShop() {
    const w = OS.createWindow({ title: 'KampfMart — Upgrades Shop', icon: '🛒', width: 640, height: 500, app: 'shop' });
    const grid = h('div', { class: 'shop-grid' });
    const head = h('div', { class: 'toolbar', style: 'padding:6px 10px' });
    w.body.append(head, grid);
    function render() {
      head.replaceChildren(h('b', { text: '🛒 KampfMart' }), h('span', { style: 'flex:1' }), h('span', { class: 'cost-pill', text: 'Wallet: ' + fmt(state.coins) + ' 🪙' }));
      grid.replaceChildren(...Economy.SHOP.map(it => {
        if (it.cat) return h('div', { class: 'shop-cat', text: it.cat });
        const owned = Economy.has(it.id), locked = it.needs && !Economy.has(it.needs);
        let btn;
        if (owned && it.theme) btn = h('button', { class: 'btn', text: state.theme === it.theme ? '✔ Active' : 'Use theme', disabled: state.theme === it.theme, onclick: () => { Economy.setTheme(it.theme); render(); } });
        else if (owned) btn = h('button', { class: 'btn', text: '✔ Owned', disabled: true });
        else btn = h('button', { class: 'btn gold', text: (locked ? '🔒 ' : 'Buy · ') + it.price + ' 🪙', disabled: locked || state.coins < it.price, onclick: () => Economy.buy(it.id) && render() });
        return h('div', { class: 'shop-item bevel' + (owned ? ' owned' : '') }, h('div', { class: 'si-head' }, h('span', { class: 'si-ico', text: it.ico }), h('span', { text: it.name })), h('div', { class: 'si-desc', text: it.desc + (locked ? ' (Requires ' + Economy.SHOP.find(x => x.id === it.needs).name + ')' : '') }), btn);
      }));
      if (state.theme) grid.append(h('div', { class: 'shop-item bevel' }, h('div', { class: 'si-head' }, h('span', { class: 'si-ico', text: '🌃' }), h('span', { text: 'Default theme' })), h('div', { class: 'si-desc', text: 'Switch back to the default editor colors.' }), h('button', { class: 'btn', text: 'Use theme', onclick: () => { Economy.setTheme(''); render(); } })));
    }
    const off = [Wallet.onChange(render), OS.on('upgrades', render)];
    w.onClose.push(() => off.forEach(f => f()));
    render();
    return w;
  }

  // ================================================================ Wallet / bank
  function openWallet() {
    const w = OS.createWindow({ title: 'Wallet', icon: '🪙', width: 380, height: 470, app: 'wallet' });
    const box = h('div', { class: 'wallet-app' }); w.body.append(box);
    let timer;
    function render() {
      const left = Economy.dailyLeft;
      const hrs = Math.floor(left / 3600e3), mins = Math.floor(left % 3600e3 / 60e3), secs = Math.floor(left % 60e3 / 1e3);
      const s = state.stats;
      box.replaceChildren(
        h('div', { class: 'bal', text: fmt(state.coins) + ' 🪙' }),
        h('button', { class: 'btn gold primary', disabled: left > 0, text: left > 0 ? '🎁 Next daily bonus in ' + hrs + 'h ' + mins + 'm ' + secs + 's' : '🎁 Claim daily bonus (+50 🪙)', onclick: (e) => { Economy.claimDaily(); render(); } }),
        h('div', { style: 'font-size:12px;line-height:1.6', html: `Earned <b>${fmt(s.earned)}</b> · Spent <b>${fmt(s.spent)}</b> · Programs run <b>${fmt(s.runs)}</b><br>Mining clicks <b>${fmt(s.clicks)}</b> · Typing jobs <b>${fmt(s.jobs)}</b> · Bounties <b>${Object.keys(state.bounties).length}/${BOUNTIES.length}</b>` }),
        h('b', { text: 'Recent transactions' }),
        h('div', { class: 'log sunken' }, ...(state.log.length ? state.log.slice(0, 40).map(l => h('div', {}, h('span', { text: new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '  ' + l.r }), h('span', { class: l.d > 0 ? 'p' : 'm', text: (l.d > 0 ? '+' : '') + l.d }))) : [h('div', { text: 'No transactions yet.' })])),
      );
    }
    const off = Wallet.onChange(render);
    timer = setInterval(() => { if (Economy.dailyLeft > 0) render(); }, 1000);
    w.onClose.push(() => { off(); clearInterval(timer); });
    render();
    return w;
  }

  // ================================================================ Files
  function openFiles() {
    const w = OS.createWindow({ title: 'Files', icon: '🗂️', width: 460, height: 420, app: 'files' });
    const list = h('div', { class: 'files-list sunken' });
    let sel = null;
    const bOpen = h('button', { class: 'btn', text: '📝 Edit' }), bRun = h('button', { class: 'btn', text: '▶ Run' }), bDel = h('button', { class: 'btn', text: '🗑 Delete' }), bRestore = h('button', { class: 'btn', text: '♻ Restore' });
    const info = h('span', { class: 'grow' });
    w.body.append(h('div', { class: 'toolbar' }, h('button', { class: 'btn', text: '📄 New', onclick: () => { const p = window.prompt('New file path:', '/home/new_program.ks'); if (p) { FS.write(p, p.endsWith('.ks') ? '# ' + p + '\nprint("hi")\n' : ''); OS.openApp('code', FS.normPath(p)); } } }), bOpen, bRun, bDel, bRestore), list, h('div', { class: 'statusbar' }, info));
    function render() {
      list.replaceChildren(); let lastDir = '';
      for (const p of FS.list('/')) {
        const dir = p.slice(0, p.lastIndexOf('/') + 1);
        if (dir !== lastDir) { list.append(h('div', { class: 'fr dir', text: '📁 ' + dir })); lastDir = dir; }
        const name = p.slice(dir.length);
        const r = h('div', { class: 'fr' + (sel === p ? ' sel' : ''), text: (p.endsWith('.ks') ? '📜 ' : '📄 ') + name });
        r.onclick = () => { sel = p; render(); }; r.ondblclick = () => OS.openApp('code', p);
        list.append(r);
      }
      const content = sel && FS.read(sel);
      info.textContent = sel ? sel + ' · ' + (content || '').length + ' bytes' : FS.list('/').length + ' files · stored in your browser';
      [bOpen, bRun, bDel].forEach(b => b.disabled = !sel); bRun.disabled = !sel || !sel.endsWith('.ks');
      bRestore.disabled = !sel || !(FS.originals && FS.originals[sel] !== undefined);
    }
    bOpen.onclick = () => sel && OS.openApp('code', sel);
    bRun.onclick = () => sel && OS.runFile(sel);
    bDel.onclick = async () => { if (!sel) return; if (await OS.dialog({ title: 'Delete', icon: '🗑', message: 'Delete ' + sel + '?', buttons: ['Delete', 'Cancel'] }) === 'Delete') { FS.remove(sel); sel = null; render(); } };
    bRestore.onclick = () => { if (sel && FS.restore(sel)) OS.toast('♻', 'Restored original ' + sel); };
    const off = OS.on('fs', render); w.onClose.push(off);
    render();
    return w;
  }

  // ================================================================ Docs
  const DOCS = [
    ['Welcome', `<h2>📘 KampfScript</h2><p>KampfScript (<code>.ks</code>) is the programming language of KampfOS. It is small, friendly and runs on a real interpreter (tokenizer → parser → tree-walking interpreter) written for this OS. Every program pays the <b>CPU tax</b>: a start fee plus 1 🪙 per batch of steps.</p>
<pre># a tiny program
let name = input("What's your name?")
for i in range(3) {
  print("Hi " + name + "! #" + str(i + 1))
}</pre><p>Open <b>KampfCode</b>, write code, press <span class="kbd">▶ Run</span> or <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span>. Save with <span class="kbd">Ctrl</span>+<span class="kbd">S</span>.</p>`],
    ['Basics', `<h2>Basics</h2><h3>Values</h3><p>numbers <code>42</code> <code>3.14</code>, strings <code>"hi"</code> or <code>'hi'</code>, booleans <code>true</code>/<code>false</code>, <code>nil</code>, lists <code>[1, 2, 3]</code>, maps <code>{name: "Kampf", age: 1}</code>.</p>
<h3>Variables</h3><pre>let x = 10
x = x + 1
x += 5        # also -=, *=, /=</pre>
<h3>Operators</h3><p><code>+ - * / %</code>, comparison <code>== != &lt; &gt; &lt;= &gt;=</code>, logic <code>and or not</code>. <code>"a" + 1</code> gives <code>"a1"</code>; <code>"ab" * 3</code> gives <code>"ababab"</code>.</p>
<h3>Comments</h3><pre># like this
// or like this</pre><p>One statement per line (or separate with <code>;</code>).</p>`],
    ['Control flow', `<h2>Control flow</h2><pre>if score > 90 {
  print("A")
} else if score > 80 {
  print("B")
} else {
  print("keep going")
}

while x < 100 { x = x * 2 }

for i in range(1, 11) { print(i) }     # 1..10
for item in ["a", "b"] { print(item) }
for ch in "hey" { print(ch) }
for key in my_map { print(key) }</pre><p><code>break</code> leaves a loop, <code>continue</code> skips to the next round.</p>`],
    ['Functions', `<h2>Functions</h2><pre>fn add(a, b) {
  return a + b
}
print(add(2, 3))

# functions are values (great for buttons!)
let double = fn(x) { return x * 2 }
print(map([1, 2, 3], double))</pre><p>Functions remember the variables around them (closures). Missing arguments become <code>nil</code>. Max 200 nested calls.</p>`],
    ['Lists & maps', `<h2>Lists & maps</h2><pre>let xs = [3, 1, 2]
push(xs, 10)
print(xs[0], xs[-1], len(xs))
xs[1] = 99

let m = {name: "Kugel", hits: 0}
m.hits += 1
m["new key"] = true
print(m.name, keys(m), has(m, "hits"))</pre><p>Reading a missing map key gives <code>nil</code>. Reading past the end of a list is an error.</p>`],
    ['Built-ins', `<h2>Built-in functions</h2><table><tr><th>Function</th><th>What it does</th></tr>
<tr><td><code>print(a, b, …)</code></td><td>print to the console</td></tr><tr><td><code>input(prompt)</code></td><td>ask the user for text</td></tr>
<tr><td><code>len(x)</code> <code>str(x)</code> <code>num(s)</code> <code>type(x)</code></td><td>length, to string, to number (or nil), type name</td></tr>
<tr><td><code>range(n)</code> <code>range(a, b, step)</code></td><td>list of numbers</td></tr>
<tr><td><code>push pop insert remove</code></td><td>edit lists (remove also works on maps)</td></tr>
<tr><td><code>keys values has</code></td><td>maps (has works on lists/strings too)</td></tr>
<tr><td><code>sort reverse map filter slice indexof contains join</code></td><td>list helpers</td></tr>
<tr><td><code>upper lower trim split replace startswith endswith substr chr ord</code></td><td>string helpers</td></tr>
<tr><td><code>floor ceil round abs sqrt pow min max sin cos random</code></td><td>math — <code>random()</code> is 0..1, <code>random(a, b)</code> an integer</td></tr>
<tr><td><code>time()</code> <code>sleep(ms)</code></td><td>milliseconds clock, wait</td></tr>
<tr><td><code>error(msg)</code></td><td>stop with your own error</td></tr>
<tr><td><code>read_file(p)</code> <code>write_file(p, s)</code> <code>list_files(dir)</code></td><td>virtual file system</td></tr>
<tr><td><code>coins()</code> <code>pay(n, why)</code> <code>has_upgrade(id)</code></td><td>economy: wallet balance, charge coins (returns true/false), check upgrades</td></tr>
<tr><td><code>open_app(name)</code></td><td>open an OS app: shop, miner, typing, bounty, wallet, files, docs, code:/path</td></tr></table>`],
    ['UI windows', `<h2>UI: windows & widgets</h2><pre>let w = window("My App", 320, 200)
let r = row(w)
let name = textbox(r, "Your name", fn(t) { greet() })
button(r, "Greet", fn() { greet() })
let out = label(w, "...", "big")
fn greet() { settext(out, "Hi " + gettext(name)) }</pre>
<table><tr><td><code>window(title, w, h)</code></td><td>new window (program keeps running while it is open)</td></tr>
<tr><td><code>row(p) col(p) scroll(p) center(p) flow(p)</code></td><td>layout containers (flow = inline paragraph)</td></tr>
<tr><td><code>label(p, text, style?)</code> <code>text(flow, s)</code></td><td>text; styles: h1 h2 h3 p small muted mono bold big error …</td></tr>
<tr><td><code>button(p, text, fn)</code> <code>link(p, text, fn, style?)</code></td><td>clickable things</td></tr>
<tr><td><code>textbox(p, placeholder, on_enter?)</code></td><td>text input</td></tr>
<tr><td><code>image(p, url)</code> <code>hr(p)</code> <code>spacer(p, px)</code></td><td>misc</td></tr>
<tr><td><code>settext gettext clear remove focus enable</code></td><td>change widgets</td></tr>
<tr><td><code>addstyle(el, name)</code> <code>setstyle(el, "color", "#f00")</code></td><td>styling</td></tr>
<tr><td><code>settitle(w, s)</code> <code>close(w)</code> <code>on_close(w, fn)</code> <code>on_click(el, fn)</code> <code>alert(msg)</code></td><td>window helpers</td></tr></table>`],
    ['Graphics', `<h2>Graphics (needs 🎨 GPU)</h2><pre>let w = window("Art", 300, 220)
let c = canvas(w, 280, 180)
clear_canvas(c, "#101426")
fill_rect(c, 10, 10, 60, 40, "#ff3c8e")
circle(c, 150, 90, 30, "#ffcc33")
line(c, 0, 0, 280, 180, "#3d7bff", 3)
draw_text(c, 10, 170, "hello", "#fff", 16)
on_click(c, fn(x, y) { circle(c, x, y, 5, "#3dd68c") })
every(50, fn() { … })   # animation timer, stop(t) to end</pre>`],
    ['Network', `<h2>Network (needs 📡 Network Card)</h2><pre>let res = search("cats")
if res.ok {
  for r in res.results { print(r.title, r.url) }
}

let page = fetch("https://example.com")
print(page.title)
for b in page.blocks { print(b.type, b.text) }</pre>
<p><code>search(q)</code> → <code>{ok, engine, results: [{title, url, snippet}], error}</code> (${'2'} 🪙)<br>
<code>fetch(url)</code> → <code>{ok, title, url, blocks, links, images, error}</code> (${'3'} 🪙). Each block has <code>type</code> (h, p, li, pre, quote, img, hr), <code>text</code>, sometimes <code>level</code>, <code>src</code> or <code>spans</code> (list of <code>{text, href}</code>).</p>
<p>Pages are downloaded by the KampfOS proxy and simplified to readable text. The <b>Kompass</b> browser (<code>/system/kompass.ks</code>) is built with exactly these functions.</p>`],
    ['Coins & costs', `<h2>🪙 The coin economy</h2><ul>
<li>Starting a program: <b>3 🪙</b> (Turbo Compiler: 2, Hyper: 1)</li>
<li>CPU time: <b>1 🪙 per 1,000 steps</b> (cache upgrades: per 2,500 / 10,000). A step is one statement, call or loop round.</li>
<li>Step limit per run (and per button click): <b>20,000</b> (RAM upgrades: 100k / 1M). Infinite loops get stopped — but you still pay.</li>
<li>Kugel search 2 🪙, loading a web page 3 🪙 (Fiber: 1 each). CoinCalc: 1 🪙 per answer.</li>
<li>Earn: ⛏ Coin Miner, ⌨ TypeCorp jobs, 🎯 Bounty Board, 🎁 daily bonus (+50).</li>
<li>Out of coins? Programs refuse to start and running ones are halted.</li></ul>`],
    ['Errors', `<h2>Errors</h2><p>Errors tell you the line and what went wrong, and KampfCode highlights the line in red:</p><pre>Line 4: Unknown name 'scroe' — did you forget 'let scroe = ...'?
Line 9: Can't add list and number
Line 2: Missing '}' — a block was never closed
Line 7: Index 5 is out of range (length 3)
Line 3: Step limit reached (20000 steps). Infinite loop? Buy more RAM in the Shop.</pre>`],
  ];
  function openDocs(section) {
    const w = OS.createWindow({ title: 'KampfScript Docs', icon: '📘', width: 680, height: 500, app: 'docs' });
    const nav = h('nav', { class: 'sunken' }); const art = h('article', { class: 'sunken' });
    w.body.append(h('div', { class: 'docs' }, nav, art));
    function show(i) { art.innerHTML = DOCS[i][1]; art.scrollTop = 0; nav.querySelectorAll('a').forEach((a, j) => a.classList.toggle('on', i === j)); }
    DOCS.forEach(([t], i) => nav.append(h('a', { text: t, onclick: () => show(i) })));
    show(Math.max(0, DOCS.findIndex(d => d[0] === section)));
    return w;
  }

  // ================================================================ Welcome
  function openWelcome() {
    const w = OS.createWindow({ title: 'Welcome to KampfOS', icon: '👋', width: 520, height: 440, app: 'welcome' });
    w.body.append(h('div', { class: 'welcome', html: `<h1>Welcome to KampfOS!</h1>
<p>This is a tiny computer with its own programming language, <b>KampfScript</b>. There's a catch: <b>nothing is free</b>. Every program you run costs coins 🪙 — like that calculator that charges money.</p>
<ul><li>You start with <b>100 🪙</b>. Running code costs 3 🪙 + 1 🪙 per 1,000 steps.</li>
<li>Earn more with <b>⛏ Coin Miner</b>, <b>⌨ TypeCorp</b> jobs and the <b>🎯 Bounty Board</b>. Claim a <b>🎁 daily bonus</b> in the Wallet.</li>
<li>Spend coins in the <b>🛒 Shop</b>: faster CPU, more RAM, themes, and the <b>📡 Network Card</b> that lets <b>🧭 Kompass</b> (a browser written in KampfScript, with the <b>Kugel</b> search engine) go online.</li>
<li>Try <b>💸 CoinCalc</b>: a calculator that charges 1 🪙 per answer.</li></ul>
<p>Windows can be dragged, resized, minimized and maximized. Double-click desktop icons to open apps.</p>
<p style="text-align:center"><button class="btn primary" id="wc-code">📝 Start coding</button> <button class="btn" id="wc-docs">📘 Read the docs</button> <button class="btn gold" id="wc-shop">🛒 Visit the shop</button></p>` }));
    w.body.querySelector('#wc-code').onclick = () => { w.close(); OS.openApp('code'); };
    w.body.querySelector('#wc-docs').onclick = () => { OS.openApp('docs'); };
    w.body.querySelector('#wc-shop').onclick = () => { OS.openApp('shop'); };
    state.welcomed = true; save();
    return w;
  }

  // ================================================================ App registry
  const APPS = [
    { id: 'code', name: 'KampfCode', ico: '📝', sub: 'Code editor', open: (arg) => { const ex = OS.findWindow('code'); if (ex && arg) { ex.focus(); ex.editor.load(arg); return ex; } if (ex && !arg) { ex.focus(); return ex; } return openEditor(arg); } },
    { id: 'kompass', name: 'Kompass', ico: '🧭', sub: 'Web browser (KampfScript)', open: () => OS.runFile('/system/kompass.ks', { icon: '🧭' }) },
    { id: 'calc', name: 'CoinCalc', ico: '💸', sub: 'Calculator · 1 🪙/answer', open: () => OS.runFile('/system/coincalc.ks', { icon: '💸' }) },
    { id: 'miner', name: 'Coin Miner', ico: '⛏️', sub: 'Click for coins', single: true, open: openMiner },
    { id: 'typing', name: 'TypeCorp', ico: '⌨️', sub: 'Typing jobs', single: true, open: openTyping },
    { id: 'bounty', name: 'Bounty Board', ico: '🎯', sub: 'Coding challenges', single: true, open: openBounty },
    { id: 'shop', name: 'Shop', ico: '🛒', sub: 'Upgrades', single: true, open: openShop },
    { id: 'wallet', name: 'Wallet', ico: '🪙', sub: 'Balance & daily bonus', single: true, open: openWallet },
    { id: 'files', name: 'Files', ico: '🗂️', sub: 'Virtual disk', single: true, open: openFiles },
    { id: 'docs', name: 'Docs', ico: '📘', sub: 'KampfScript manual', single: true, open: openDocs },
  ];
  OS.openApp = function (id, arg) {
    const a = APPS.find(x => x.id === id) || (id === 'welcome' && { single: true, open: openWelcome, id: 'welcome' });
    if (!a) { OS.toast('❓', 'Unknown app: ' + id); return null; }
    if (a.single) { const ex = OS.findWindow(a.id); if (ex) { ex.focus(); return ex; } }
    if ((id === 'kompass' || id === 'calc') && state.coins < Economy.runCost) { OS.brokeDialog('Launching ' + a.name + ' costs ' + Economy.runCost + ' 🪙 (it is a KampfScript program, and programs cost money).'); return null; }
    return a.open(arg);
  };

  // ================================================================ Desktop shell
  function buildDesktop() {
    const icons = $('#icons');
    APPS.forEach(a => {
      const d = h('div', { class: 'dicon', tabindex: 0, title: a.sub }, h('div', { class: 'ico', text: a.ico }), h('div', { class: 'lbl', text: a.name }));
      d.addEventListener('click', () => { icons.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); d.classList.add('sel'); });
      d.addEventListener('dblclick', () => OS.openApp(a.id));
      d.addEventListener('keydown', (e) => { if (e.key === 'Enter') OS.openApp(a.id); });
      icons.append(d);
    });
    $('#desktop').addEventListener('pointerdown', (e) => { if (e.target.id === 'desktop' || e.target.id === 'windows') icons.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); });
    // start menu
    const sm = $('#start-menu');
    const items = h('div', { class: 'sm-items' });
    APPS.forEach(a => items.append(h('div', { class: 'sm-item', onclick: () => { sm.hidden = true; OS.openApp(a.id); } }, h('span', { class: 'ico', text: a.ico }), h('div', {}, a.name, h('small', { text: a.sub })))));
    items.append(h('div', { class: 'sm-sep' }),
      h('div', { class: 'sm-item', onclick: () => { sm.hidden = true; OS.openApp('welcome'); } }, h('span', { class: 'ico', text: '👋' }), h('div', {}, 'Welcome / help')),
      h('div', { class: 'sm-item', onclick: async () => { sm.hidden = true; if (await OS.dialog({ title: 'Factory reset', icon: '💣', message: 'Erase all coins, upgrades and files and start over?', buttons: ['Erase everything', 'Cancel'] }) === 'Erase everything') { localStorage.removeItem('kampfos.state.v1'); localStorage.removeItem('kampfos.fs.v1'); location.reload(); } } }, h('span', { class: 'ico', text: '💣' }), h('div', {}, 'Factory reset')));
    sm.append(h('div', { class: 'sm-side', html: 'Kampf<b>OS</b> 1.0' }), items);
    $('#start-btn').onclick = (e) => { e.stopPropagation(); sm.hidden = !sm.hidden; $('#start-btn').classList.toggle('pressed', !sm.hidden); };
    document.addEventListener('pointerdown', (e) => { if (!sm.hidden && !e.target.closest('#start-menu') && !e.target.closest('#start-btn')) { sm.hidden = true; $('#start-btn').classList.remove('pressed'); } });
    // wallet tray
    const wal = $('#wallet');
    const renderWallet = (delta, fromEl) => {
      wal.querySelector('b').textContent = fmt(state.coins);
      wal.classList.toggle('broke', state.coins < Economy.runCost);
      if (delta) {
        wal.classList.remove('flash-up', 'flash-down'); void wal.offsetWidth; wal.classList.add(delta > 0 ? 'flash-up' : 'flash-down');
        let x, y;
        if (fromEl && fromEl.clientX !== undefined) { x = fromEl.clientX; y = fromEl.clientY - 20; }
        else if (fromEl && fromEl.getBoundingClientRect) { const r = fromEl.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top; }
        else { const r = wal.getBoundingClientRect(); x = r.left + 10; y = r.top - 16; }
        const f = h('div', { class: 'coin-float ' + (delta > 0 ? 'up' : 'down'), text: (delta > 0 ? '+' : '') + delta + ' 🪙', style: `left:${x}px;top:${y}px` });
        document.body.append(f); setTimeout(() => f.remove(), 1000);
      }
    };
    wal.onclick = () => OS.openApp('wallet');
    Wallet.onChange(renderWallet); renderWallet();
    OS.on('upgrades', () => renderWallet());
    // clock
    const clk = () => { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
    clk(); setInterval(clk, 10000);
    // auto miner
    setInterval(() => { if (Economy.has('automine') && !document.hidden) Wallet.add(1, 'Auto-Miner'); }, 6000);
    Economy.setTheme(state.theme);
  }

  // ================================================================ Boot
  async function boot() {
    const bootEl = $('#boot');
    const lines = ['KampfOS BIOS v1.0  (c) 2026 Kampf Industries', 'CPU: KampfCore 1-coin edition ........ OK', 'Memory test: ' + fmt(Economy.maxSteps) + ' steps ........ OK', 'Mounting virtual disk ........'];
    bootEl.textContent = lines.join('\n');
    await FS.loadDefaults(VERSION);
    bootEl.textContent = lines.concat(['Mounting virtual disk ........ OK', 'Wallet: ' + fmt(state.coins) + ' coins', 'Starting desktop...']).join('\n');
    buildDesktop();
    $('#desktop').hidden = false;
    setTimeout(() => { bootEl.style.transition = 'opacity .4s'; bootEl.style.opacity = 0; setTimeout(() => bootEl.remove(), 400); }, 350);
    // deep links: ?open=code,kompass&file=/examples/loops.ks&go=cats
    const q = new URLSearchParams(location.search);
    const open = (q.get('open') || '').split(',').filter(Boolean);
    if (open.length) {
      for (const id of open) {
        if (id === 'kompass' && q.get('go')) {
          const src = FS.read('/system/kompass.ks').replace('navigate(HOME)\n', 'navigate(HOME)\n') ;
          const proc = OS.runProgram(src.replace(/\nnavigate\(HOME\)\s*$/, '\nnavigate(' + JSON.stringify(q.get('go')) + ')\n'), { name: 'kompass', path: '/system/kompass.ks', icon: '🧭' });
        } else OS.openApp(id, id === 'code' ? (q.get('file') || undefined) : undefined);
      }
    } else if (!state.welcomed) openWelcome();
  }
  OS.boot = boot;
})();
