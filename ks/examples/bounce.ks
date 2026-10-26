# Bouncing ball animation — needs the GPU upgrade.
# every(ms, fn) calls fn again and again. Watch your coins: animations use steps!

let w = window("Bounce", 360, 300)
let cv = canvas(w, 320, 240)
let x = 40
let y = 40
let dx = 4
let dy = 3
let r = 14

every(30, fn() {
  x += dx
  y += dy
  if x < r or x > 320 - r { dx = -dx }
  if y < r or y > 240 - r { dy = -dy }
  clear_canvas(cv, "#101426")
  circle(cv, x, y, r, "#ffcc33")
  draw_text(cv, 8, 18, "KampfOS", "#ff6ad5", 12)
})
