# KampfOS 🪙

**Live:** https://kampfguy.github.io/kampfos/ (desktop computers only)

A retro desktop OS in the browser where **running code costs coins** — like that calculator that charges money.

- **KampfScript** — its own programming language (tokenizer → parser → tree-walking interpreter in `js/lang.js`, no `eval`). Variables, numbers/strings/lists/maps, if/else, loops, functions & closures, input/print, plus UI, graphics and network APIs.
- **KampfCode** — editor with syntax highlighting, line numbers, run/stop, console, cost meter, virtual file system (localStorage), examples.
- **Coin economy** — start with 100 🪙. Each run costs 3 🪙 + 1 🪙 per 1,000 interpreter steps. Earn with Coin Miner, TypeCorp typing jobs, Bounty Board coding challenges and a daily bonus. Spend in the Shop on faster CPU, more RAM, the Network Card, GPU, mining gear, editor themes.
- **Kompass** — a web browser *written in KampfScript* (`ks/kompass.ks`, editable at `/system/kompass.ks` inside the OS) with **Kugel**, a search engine that's like Google but way simpler.
- **CoinCalc** — a calculator written in KampfScript that charges 1 🪙 per answer.
- **worker/** — `kampfos-proxy` Cloudflare Worker: `/read?url=` fetches a page server-side and returns simplified JSON; `/search?q=` returns search results (DuckDuckGo, falling back to Wikipedia). CORS locked to kampfguy.github.io, http(s) only, private IPs blocked, size-limited.

Run the interpreter tests: `node tests/lang.test.js`
