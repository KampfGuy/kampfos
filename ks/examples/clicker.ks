# A tiny window app: click the button, watch the counter.

let clicks = 0
let w = window("Clicker", 300, 200)
let c = center(w)
let count = label(c, "0 clicks", "big")
let r = row(c)
button(r, "Click me!", fn() {
  clicks += 1
  settext(count, str(clicks) + " clicks")
})
button(r, "Reset", fn() {
  clicks = 0
  settext(count, "0 clicks")
})
label(c, "Every click runs KampfScript code (and uses a few steps)", "small")
