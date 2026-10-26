# ============================================================
#  CoinCalc 💸 — the calculator that costs money.
#  Every answer (pressing =) costs 1 coin. Written in KampfScript.
# ============================================================
let win = window("CoinCalc 💸", 280, 400)
let display = label(win, "0", "calc-display")
let info = label(win, "Each answer costs 1 🪙  ·  Wallet: " + str(coins()), "small")

let entry = "0"      # what is on screen
let acc = nil        # stored number
let op = nil         # pending operator
let fresh = true     # next digit starts a new number

fn show() {
  settext(display, entry)
  settext(info, "Each answer costs 1 🪙  ·  Wallet: " + str(coins()))
}

fn apply(a, o, b) {
  if o == "+" { return a + b }
  if o == "-" { return a - b }
  if o == "×" { return a * b }
  if o == "÷" {
    if b == 0 { return "NOPE" }
    return a / b
  }
  return b
}

fn press(k) {
  if contains("0123456789", k) {
    if fresh or entry == "0" { entry = k } else { entry = entry + k }
    fresh = false
  } else if k == "." {
    if fresh { entry = "0." } else if not contains(entry, ".") { entry = entry + "." }
    fresh = false
  } else if k == "C" {
    entry = "0"
    acc = nil
    op = nil
    fresh = true
  } else if k == "=" {
    if op == nil { return }
    if not pay(1, "CoinCalc answer") {
      entry = "INSERT COIN"
      fresh = true
      show()
      return
    }
    let r = apply(acc, op, num(entry))
    entry = str(r)
    acc = nil
    op = nil
    fresh = true
  } else {
    # operator
    if op != nil and not fresh {
      if not pay(1, "CoinCalc answer") {
        entry = "INSERT COIN"
        show()
        return
      }
      entry = str(apply(acc, op, num(entry)))
    }
    acc = num(entry)
    op = k
    fresh = true
  }
  show()
}

let keys = [["7", "8", "9", "÷"], ["4", "5", "6", "×"], ["1", "2", "3", "-"], ["C", "0", ".", "+"]]
for r in keys {
  let rw = row(win)
  addstyle(rw, "calc-row")
  for k in r {
    let b = button(rw, k, fn() { press(k) })
    if contains("÷×-+", k) { addstyle(b, "calc-op") }
  }
}
let last = row(win)
addstyle(last, "calc-row")
let eq = button(last, "=  (1 🪙)", fn() { press("=") })
addstyle(eq, "calc-eq")
show()
