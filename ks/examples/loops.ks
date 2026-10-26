# Loops: for, while, break and continue

# count from 1 to 5
for i in range(1, 6) {
  print("count", i)
}

# add up 1..100
let total = 0
for n in range(1, 101) {
  total += n
}
print("sum 1..100 =", total)

# FizzBuzz
for n in range(1, 16) {
  if n % 15 == 0 { print("FizzBuzz") }
  else if n % 3 == 0 { print("Fizz") }
  else if n % 5 == 0 { print("Buzz") }
  else { print(n) }
}

# while with break
let x = 1
while true {
  x = x * 2
  if x > 1000 { break }
}
print("first power of two over 1000:", x)
