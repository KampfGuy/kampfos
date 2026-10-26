# Guess the number — uses input() to ask questions in the console

let secret = random(1, 50)
let tries = 0
print("I'm thinking of a number from 1 to 50...")

while true {
  let g = num(input("Your guess:"))
  tries += 1
  if g == nil {
    print("That's not a number!")
  } else if g < secret {
    print(str(g) + " is too low")
  } else if g > secret {
    print(str(g) + " is too high")
  } else {
    print("Correct! You got it in " + str(tries) + " tries 🎉")
    break
  }
}
