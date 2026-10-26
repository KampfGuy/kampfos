# Paint — needs the GPU upgrade from the Shop.
# Click the canvas to drop paint blobs.

let w = window("Paint", 460, 420)
let tools = row(w)
let color = "#ff3c8e"
let size = 10
for c in ["#ff3c8e", "#3d7bff", "#3dd68c", "#ffcc33", "#222222"] {
  let b = button(tools, "■", fn() { color = c })
  setstyle(b, "color", c)
}
button(tools, "+", fn() { size = min(size + 4, 40) })
button(tools, "-", fn() { size = max(size - 4, 2) })
button(tools, "Clear", fn() { clear_canvas(cv, "#ffffff") })

let cv = canvas(w, 420, 320)
clear_canvas(cv, "#ffffff")
draw_text(cv, 12, 24, "Click to paint!", "#999999", 16)
on_click(cv, fn(x, y) {
  circle(cv, x, y, size, color)
})
