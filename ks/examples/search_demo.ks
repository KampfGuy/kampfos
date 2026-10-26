# Use the web from code! Needs the Network Card upgrade.
# search() costs coins just like in the Kompass browser.

let res = search("KampfScript programming language")
if not res.ok {
  print("Search failed:", res.error)
} else {
  print("Engine:", res.engine)
  for r in res.results {
    print("- " + r.title)
    print("  " + r.url)
  }
}
