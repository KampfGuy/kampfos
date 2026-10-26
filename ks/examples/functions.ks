# Functions, recursion, closures, lists and maps

fn square(n) {
  return n * n
}
print("square(12) =", square(12))

fn fib(n) {
  if n < 2 { return n }
  return fib(n - 1) + fib(n - 2)
}
print("fib(15) =", fib(15))

# functions are values
let nums = [5, 3, 8, 1]
print("doubled:", map(nums, fn(x) { return x * 2 }))
print("big ones:", filter(nums, fn(x) { return x > 4 }))
print("sorted:", sort(nums))

# closures remember their variables
fn make_counter() {
  let count = 0
  return fn() {
    count += 1
    return count
  }
}
let tick = make_counter()
tick()
tick()
print("counter is at", tick())

# maps hold named fields
let me = {name: "Kampf", coins: coins(), langs: ["KampfScript"]}
me.level = 1
print(me.name, "has", me.coins, "coins")
print(me)
