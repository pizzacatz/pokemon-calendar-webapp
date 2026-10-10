# Future ideas — nice-to-haves, not planned work

Things that came up and were deliberately left out. Nothing here is live.
Each entry says what it is, why it was parked, and where any existing work
sits, so it can be picked up without re-deriving it.

## Player counts (final turnout on past events)

**Idea:** show how many players attended each past sanctioned event, e.g.
"21 players (J 0 / S 0 / M 21)" — as a Players row in the event detail
modal, a badge on List rows, a suffix in the day-list modal, and a line in
the copy-event-details output.

**Why parked (Sept 2026):** the numbers only exist on the logged-in Play!
Pokémon tournament pages, and pokemon.com's firewall blocks automated
browsers outright. Without a way to fetch them there is nothing to show.

**Where the work is:** unfinished, shelved on the `player-counts` git
branch (branched from `main` in Oct 2026; not merged, and only on the local
machine unless it has been pushed since).

- `tools/player-counts/` — the fetch-and-write job; its `README.md` has the
  full status and the likeliest way forward (a small extension in a real
  Chrome profile posting counts to an Apps Script web app).
- Edits to `app.js`, `index.html`, `styles.css` and `.gitignore` — the
  display side, which reads a `Players:` line from an event's description.

**Known loose end:** in the event detail modal the "Players" label shows
with no value for events that have no count; the row should be hidden.

## "View all" including past events

**Idea:** let the List view's "View all" also show events that already
happened.

**Why parked (Oct 2026):** past events at the top of the List were the main
complaint that led to the 30-day redesign. "View all" is upcoming-only for
now; past events are still reachable with the previous button, 30 days at a
time.

## Date pickers / "Jump to date" in the List view

**Idea:** choose a specific date range for the List instead of stepping 30
days at a time.

**Why parked (Oct 2026):** the next 30 days, Next, "View all" and Month view
already cover the common questions, and two date fields crowd the phone
toolbar. If it is wanted later, a single "Jump to date" field that sets the
start of the 30-day window is the lighter version.
