# Pokémon Events Calendar

A single-page, dependency-light web calendar showing competitive Pokémon events
(TCG, VGC, GO, prereleases, community) from six public Google Calendars.
Plain HTML/CSS/JS — no framework, no build step. Deployed on GitHub Pages and
embedded into carrd.co pages as an auto-sizing iframe widget.

**Live:** https://pizzacatz.github.io/pokemon-calendar-webapp/

## Architecture

```
pokedata.ovh ICS feeds
      │  (Google Apps Script sync, daily — lives in the private
      │   pizzacatz/pokemon-calendar repo; copies in *.gs here)
      ▼
6 public Google Calendars  ──Google Calendar API──▶  this app (FullCalendar 6.1.21)
                                                          │
                                                          ▼
                                             GitHub Pages ─▶ carrd.co iframes
```

| File | Role |
|---|---|
| `index.html` | page shell, CDN script tags, filter panel + modal markup |
| `app.js` | config, calendar setup, filtering, custom week view, modals, embed plumbing |
| `styles.css` | dark theme (`#1A1A1A` / `#1F1F1F` / gold `#FFD180`), mobile rules |
| `pokemon_calendar_sync*.gs` | reference copies of the Apps Script pipeline (not used by the app) |
| `pokemon-events-calendar-PRD.md` | original spec + addendum of post-launch changes |

## Configuration (top of `app.js`)

- `GOOGLE_CALENDAR_API_KEY` — public by design; **must stay restricted** in
  Google Cloud Console to the Calendar API + HTTP referrers
  (`pizzacatz.github.io/*`, `localhost:8000/*`).
- `DISPLAY_TIME_ZONE` — fixed `America/New_York`; times are labeled "ET".
- `CALENDARS` — one entry per category (id, chip label, color, Google Calendar
  ID). Add/remove categories by editing only this list.

Every calendar must be public with **"See all event details"** — the
free/busy-only sharing level strips titles/locations and events render as
"(untitled)".

## Embedding (carrd.co or any site)

**Important:** carrd "pages" are sections of ONE HTML document, so every embed
on the site coexists in the same DOM. Never target the iframe by id (ids
collide and all height messages land on the first iframe — some embeds stay
clipped, others inflate with empty space). Match by `e.source` instead.

Each embed is just an iframe (vary `view=`/`cats=` per page):

```html
<iframe
  src="https://pizzacatz.github.io/pokemon-calendar-webapp/?embed=1"
  style="width:100%; height:900px; border:0;"
  scrolling="no"
  title="Pokémon Events Calendar"></iframe>
```

Plus this listener once anywhere on the site (per-embed duplicates are
harmless — it routes each message to the iframe that sent it):

```html
<script>
window.addEventListener('message', function (e) {
  if (e.origin !== 'https://pizzacatz.github.io') return;
  if (!e.data || e.data.type !== 'pokecal:height') return;
  document.querySelectorAll('iframe').forEach(function (f) {
    if (f.contentWindow === e.source) f.style.height = e.data.height + 'px';
  });
});
</script>
```

The app posts its content height (`pokecal:height`) whenever it changes —
view switches, data loads, modals opening/closing — so each iframe grows AND
shrinks to fit and the page never double-scrolls. The 900px is only a
pre-load fallback.

### Per-page URL parameters

| Param | Values | Effect |
|---|---|---|
| `embed=1` | — | bare widget: hides the app's own header/footer |
| `view=` | `month`, `week`, `list` (alias `agenda`) | initial view; default `month` |
| `cats=` | comma list of `tcg-cups`, `tcg-challenges`, `vgc`, `go`, `prerelease`(`s`), `community` | categories enabled at load; all others start toggled off (chips remain tappable) |

Examples for dedicated pages:

```
TCG page (month):        ?embed=1&view=month&cats=tcg-cups,tcg-challenges
VG/GO page (agenda):     ?embed=1&view=agenda&cats=vgc,go
Prerelease page (agenda): ?embed=1&view=agenda&cats=prereleases
Everything (default):    ?embed=1
```

Any number of widgets can coexist — the `e.source`-matching listener above
routes each height message to its own iframe automatically.

## Features

- **Views:** Month, custom "Week" (7-day strip with per-category activity
  dots + one-day list, like the old eventscalendar.co widget), and a rolling
  30-day List anchored on today.
- **Filtering:** always-visible toggle chips, one per category, colored;
  works in every view (toggles the FullCalendar event source).
- **Mobile (≤767px):** month cells show dots instead of chips; tapping a day
  opens a list modal (title, time below); list rows stack title / time /
  address; toolbar stacks.
- **Event popup:** title, when (ET), where (Google Maps directions link),
  description text (URLs become links), inline images from Drive attachments
  or direct image URLs in the description. Never links to the Google Calendar
  event page.
- **Locations** are cleaned of the upstream feed's `, US, , City/US` tail.

## Development

```bash
python3 -m http.server 8000    # serve from the repo root
# http://localhost:8000        (localhost:8000 must be in the API key's referrer list)
```

Deploy = `git push` (Pages serves `main` at root). Builds occasionally sit in
"queued/building" for 10+ minutes; kick one with:

```bash
gh api -X POST repos/pizzacatz/pokemon-calendar-webapp/pages/builds
```

## Gotchas (hard-won)

- **Fake-UTC dates:** with a named `timeZone` and no timezone plugin,
  FullCalendar's `event.start/end` are Dates whose *UTC* fields hold the
  Eastern wall time. Format with `timeZone:'UTC'` and label "ET" manually;
  formatting with `America/New_York` double-shifts.
- **Iframe height:** `body.scrollHeight` misses the last element's collapsed
  bottom margin and floors fractional heights — report `+16px` or the bottom
  border clips. Modals are `position:fixed` (invisible to body height), so
  they're measured separately.
- **Modal position in the embed:** `fixed` + centered = middle of the whole
  grown iframe, not the visitor's screen. The app anchors modal boxes to the
  last click's Y position when embedded.
- **Injected DOM vs FullCalendar:** FC recreates its view harness on view
  changes and can strand foreign elements (the week strip); re-check position
  each update, not just `isConnected`.
- **Drive attachments** only display if the file itself is shared
  "anyone with the link" — a public calendar does not make its attachments
  public. Failed images fall back to plain links.
- **Headless Chrome** clamps windows to 500px wide — "phone" screenshots below
  that are crops, not reflows. Synthetic `MouseEvent`s can lose coordinates in
  iframes; only trusted input proves click-anchoring.
