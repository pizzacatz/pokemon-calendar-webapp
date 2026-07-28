# Technical Vocabulary — this project, three ways

The same story told three times: (1) in full industry jargon, (2) in plain
language with the matching technical term after each phrase, (3) as a
glossary table anchoring every term to the moment it appeared in this
project. Read 1 to test yourself, 2 to decode it, 3 to make it stick.

---

## 1. The jargon-dense version

### What it is

pokemon-calendar-webapp is a **static site** — plain HTML/CSS/JS with
**no build step and no framework** — that renders competitive Pokémon
events by wrapping **FullCalendar v6**, loaded via pinned-version **CDN**
`<script>` tags (`fullcalendar@6.1.21`) together with its Google Calendar
**plugin**. The plugin treats each of six community calendars as a
FullCalendar **event source**, fetched live through the **Google
Calendar API** using a **client-side API key** that is intentionally
public but locked down with **HTTP referrer allowlisting** in Google
Cloud Console. `app.js` is a single **imperative DOM-manipulation
script** — no virtual DOM, no component framework — that configures
FullCalendar declaratively and then hand-builds three custom UI pieces
on top of it: a **day-strip view** (a widget-style 7-day picker feeding
a filtered list), a mobile **day-list modal**, and an **event detail
modal**.

### Rendering, filtering, and state

Category filtering is modeled as a **Set-based filter state**
(`activeCats`), not per-chip visibility toggles: an empty set means "no
filter, show everything," and FullCalendar's `addEventSource`/
`removeEventSource` are called reactively so the same filter logic works
across every **view** (month/week/list) without a data refetch. All
calendar-sourced strings are written with `textContent`/
`createTextNode` rather than `innerHTML` — an implicit **XSS
mitigation**, since the data ultimately comes from publicly editable
Google Calendars. Two DOM-timing gotchas recur: FullCalendar tears down
and rebuilds its **view harness** on every navigation, which can
**strand** foreign elements appended inside it (the day-strip is
re-verified and re-attached on every update rather than assumed still in
place); and the app's own height report to the parent page must add a
manual +16px because `body.scrollHeight` misses the last element's
collapsed bottom margin (**margin collapsing**) and rounds fractional
heights down.

### Time handling

With a named `timeZone` and no timezone plugin, FullCalendar exposes
event dates in **"fake UTC"** form — a JS `Date`'s UTC-labeled fields
actually hold the Eastern **wall-clock time**. Formatting must therefore
force `timeZone:'UTC'` and label the result "ET" manually; formatting
with the real IANA zone double-shifts the displayed time.

### Embedding and cross-frame communication

The app runs standalone or **iframe-embedded** on carrd.co pages, with
an `?embed=1` **query parameter** stripping chrome and `?view=`/`?cats=`
seeding per-embed defaults. Since a child iframe's parent can't inspect
its DOM, the app measures its own height and relays it out via
`window.postMessage` — a **cross-origin messaging** channel — under a
custom `pokecal:height` message type, triggered by a **ResizeObserver**
watching `document.body`. The parent-side listener routes each height
message to the correct iframe by matching **`event.source`** (the
sending window) against each iframe's `contentWindow`, rather than by
DOM `id` — necessary because carrd bundles multiple embeds into one page,
where id-based routing would collide and misapply height updates. Modal
placement inside an embed can't use viewport-centered `position:fixed`
(that would center on the whole, possibly very tall, iframe); instead
the app records the last **trusted click**'s document-relative Y
coordinate and anchors the modal box near it.

### The data pipeline (outside the deployed app)

Calendar data is produced upstream by Apps Script programs kept here
only as reference copies (not run as part of this app). `ics_formatter.js`
is a Google Apps Script **web app** (`doGet`) that fetches an upstream
**ICS feed** (the `iCalendar` format, RFC 5545), manually **unfolds and
refolds** its `VEVENT` blocks (ICS lines over ~74 chars are line-folded
with a leading-space continuation per spec) to rewrite titles and
descriptions. `pokemon_calendar_sync*.gs` performs the actual **sync**,
importing each cleaned feed into its own Google Calendar through the
**Advanced Calendar Service**'s `Events.import`, keyed on each event's
ICS **UID** so repeated runs are **idempotent**. The sync is deliberately
**create-only** (an event, once imported, is never overwritten, so manual
edits survive) and uses **tombstoning** to remember owner-initiated
deletions so a still-present upstream event is never silently
resurrected. A separate script, `community_event_form.gs`, runs a small
**moderation workflow**: a Google Form feeds a linked response sheet, an
`onFormSubmit` **trigger** marks new rows `PENDING`, the owner flips a
**data-validated** dropdown to `APPROVED`, and an `onEdit` trigger
publishes the event — a **status state machine**
(`PENDING → APPROVED → PUBLISHED`, plus `REJECTED` / `REMOVE → REMOVED`
/ `ERROR`) implemented entirely in spreadsheet cells and script triggers.

### Deployment

Deployment is a **GitHub Actions CI/CD workflow**
(`.github/workflows/pages.yml`) firing on every push to `main`, using
`actions/upload-pages-artifact` + `actions/deploy-pages` rather than the
legacy Jekyll-based Pages build. A **concurrency group**
(`cancel-in-progress: true`) prevents overlapping deploys from racing.
Because there's no bundler, the "build" is just the repo uploaded as an
**artifact** as-is.

---

## 2. The plain-language version

This project is a website with no moving build parts (**static site**) —
just plain files, no compiler step and no JavaScript framework
(**no build step, no framework**) — that shows Pokémon competitive event
listings by loading a ready-made calendar widget library from a public
file-hosting service (**FullCalendar**, via a **CDN**), plus an add-on
piece it ships (a **plugin**) that knows how to read Google Calendars.
That add-on treats each of six calendars as a place to pull events from
(an **event source**), talking to Google's live calendar-reading service
(the **Google Calendar API**) using a password-like key sent straight
from the browser (a **client-side API key**) — safe here only because
Google is told to only honor requests coming from this site's own domain
(**HTTP referrer allowlisting**). The whole app's logic is one file
(`app.js`) that pokes at the webpage directly (**imperative DOM
manipulation**) rather than using a framework that redraws things for
you, and on top of the calendar widget it hand-builds three extra
screens: a horizontal week-of-buttons picker (**day-strip view**), a
popup listing everything on one tapped day (**day-list modal**), and a
popup showing one event's full details (**event detail modal**).

Which category chips are "on" is tracked as a simple list of selected
categories (**Set-based filter state**): an empty list means "nothing is
being filtered, show it all," and the app adds or removes calendars from
the widget accordingly, so the same on/off logic works whether you're
looking at the month grid, the week strip, or the list (**view**). Any
text pulled from a calendar (titles, descriptions) is inserted as plain
text rather than as raw HTML, which quietly blocks a class of security
bug where hidden code sneaks in through the data (**XSS mitigation**) —
worth doing since anyone can edit these Google Calendars. Two easy-to-miss
timing quirks show up: the calendar widget rebuilds its own inner
container every time you switch views (**view harness**), which can
leave the app's own custom elements orphaned in the wrong spot
(**stranding**) unless it re-checks and reattaches them each time; and
when the app reports its own height to the page it's embedded in, it has
to pad the number by 16 pixels, because the browser's own height reading
quietly ignores a bit of empty space below the last element
(**margin collapsing**) and rounds down.

There's one date-formatting trap worth knowing: when you tell the
calendar widget a named time zone but don't load its separate time-zone
plugin, it hands back JavaScript dates that are secretly lying — the
part of the date object that's supposed to be universal time actually
holds Eastern local time (**"fake UTC"**). So the app has to format
those dates by asking for "UTC" and manually writing "ET" next to the
result; asking for the real time zone would shift the displayed time
twice.

The app is built to work either as its own page or dropped inside
another site's page as a little embedded window (**iframe embedding**),
and a special bit added to its URL (**query parameter**, `?embed=1`,
`?view=`, `?cats=`) lets each embed hide its header and pick its own
starting view and categories. Because the outer page can't peek inside
an iframe to see how tall its content is, the app measures its own
height and sends that number out through the browser's cross-page
messaging system (**`postMessage`**, a form of **cross-origin
messaging**), using a custom label so the receiving page knows what the
message means, triggered automatically whenever the page's size changes
(**ResizeObserver**). The outer page's listener figures out which of
possibly several embedded windows sent a given height by comparing which
window object actually sent it (**`event.source`** matching) rather than
by name/id — necessary because the site that embeds this app can have
several copies of it on one page, where id-based matching would mix them
up. Popup boxes inside an embed can't just be centered on the screen the
normal way, since "centered" there would mean the middle of the whole
(possibly very tall) embedded frame; instead the app remembers exactly
where on the page you last clicked (a real, browser-verified click, not
a scripted one — a **trusted click**) and opens the popup near that spot.

Behind the scenes — not part of the deployed website, just reference
copies kept in this repo — two small Google-hosted scripts do the actual
data wrangling. One (`ics_formatter.js`) is itself a tiny web service
(a Google Apps Script **web app**) that downloads a standard calendar
export file from another site (an **ICS feed**, the same universal
format — **iCalendar**, RFC 5545 — used by Outlook/Apple Calendar), joins
lines that the format allows to be split across rows for readability
(**unfolding**, then **re-folding** them back for output) around each
individual event's block (a **VEVENT**), and rewrites its title/
description. The other (`pokemon_calendar_sync*.gs`) actually copies
those cleaned-up events into real Google Calendars, matching each import
against a previous one by the event's unique tracking id (**UID**) so
running it twice never creates duplicates (**idempotent**). It only ever
creates new events and never overwrites one that already exists
(**create-only**), so an owner's manual edits are never clobbered, and it
remembers on-purpose deletions (**tombstoning**) so a deleted event
doesn't silently reappear just because it's still in the upstream feed.
A third script (`community_event_form.gs`) runs a simple approval
process (**moderation workflow**): a public form feeds a spreadsheet,
an automatic "someone submitted the form" alarm (**trigger**) marks the
new row as waiting, the site owner flips a locked-down dropdown menu
(**data validation**) to approve it, and an automatic "someone edited a
cell" alarm publishes the event — a small set of named stages an entry
moves through in order (a **state machine**): waiting, approved,
published, or rejected/removed.

Finally, publishing the site to the internet is automated
(**CI/CD**, via a **GitHub Actions workflow**) — every push to the main
branch triggers a job that uploads the repo and flips it live, replacing
an older, slower system (**Jekyll build**) that used to fail with vague
errors. A setting ensures that if two deploys ever overlap, the newer
one cancels the older instead of racing it (**concurrency group**). Since
there's no compiling step, "building" the site is just packaging the
repo's files as-is and handing them to GitHub Pages (a deploy
**artifact**).

---

## 3. Glossary — term → meaning → where it happened here

### Frontend & rendering

| Term | Plain meaning | In this project |
|---|---|---|
| **static site** | files served as-is, no server-side rendering | the whole repo: `index.html` + `app.js` + `styles.css`, `python3 -m http.server` for local dev |
| **no build step, no framework** | no compiler/bundler, no React/Vue-style component system | README's own description; `app.js` is one plain script, no `package.json` |
| **CDN (pinned dependency)** | loading a library from a public host at a fixed version | `fullcalendar@6.1.21` and the Google Calendar plugin, pinned in `index.html`'s `<script>` tags |
| **plugin** | an add-on module a library exposes to extend it | FullCalendar's `@fullcalendar/google-calendar` plugin, loaded as its own CDN script |
| **imperative DOM manipulation** | building/updating the page by directly calling DOM methods | `app.js` throughout — `document.createElement`, `.appendChild`, manual class toggling |
| **custom view** | a widget-style screen the app builds beyond the library's defaults | the `weekStrip` day-strip view and the mobile day/event modals in `app.js` |
| **Set-based filter state** | tracked selection using a JS `Set`, empty = "no filter" | `activeCats` in `app.js`; `catVisible()` checks `activeCats.size === 0` |
| **XSS mitigation** | avoiding injected HTML/script from untrusted text | `renderDescription`/`openEventModal` use `textContent`/`createTextNode`, never `innerHTML`, for calendar-sourced text |

### Time & DOM-timing gotchas

| Term | Plain meaning | In this project |
|---|---|---|
| **"fake UTC"** | a Date object whose UTC fields secretly hold local wall time | README's "Fake-UTC dates" gotcha; `FAKE_UTC = {timeZone:'UTC'}` in `app.js`, used to format without double-shifting |
| **view harness** | the container a UI library tears down/rebuilds on navigation | FullCalendar's `.fc-view-harness`; `ensureStripAttached()` re-checks it every update |
| **DOM node stranding** | an injected element left behind/misplaced after a re-render | the day-strip being left after the harness on a view switch — the bug `ensureStripAttached()` guards against |
| **margin collapsing** | a trailing element's bottom margin not counted in scroll height | README's "Iframe height" gotcha; the `+16` in `postHeight()` |

### Embedding & cross-frame communication

| Term | Plain meaning | In this project |
|---|---|---|
| **iframe embedding** | showing this page inside another site's `<iframe>` | the carrd.co embed snippet in README; `?embed=1` mode |
| **query parameter** | a `?key=value` pair on the URL configuring the page | `?embed=1`, `?view=month\|week\|list`, `?cats=vgc,go` — parsed via `PAGE_PARAMS` |
| **postMessage / cross-origin messaging** | sending data between windows across origins | `window.parent.postMessage({type:'pokecal:height', height}, '*')` in `postHeight()` |
| **ResizeObserver** | a browser API that fires when an element's size changes | `new ResizeObserver(postHeight).observe(document.body)` |
| **`event.source` identity matching** | telling messages apart by which window sent them, not a name | the carrd-side listener in README matches `f.contentWindow === e.source`, not iframe `id`, so multiple embeds don't collide |
| **trusted click** | a real user-generated click event, as opposed to a scripted one | README's Headless Chrome gotcha; `lastClickY` is captured from real `click` events to anchor modals |

### Calendar & Google Calendar integration

| Term | Plain meaning | In this project |
|---|---|---|
| **event source** | a FullCalendar-recognized origin of calendar events | each `CALENDARS` entry becomes one via `sourceConfig()` / `googleCalendarId` |
| **Google Calendar API** | Google's service for reading calendar data | fetched by the FullCalendar Google Calendar plugin using `googleCalendarApiKey` |
| **client-side API key** | an API credential shipped in browser-visible code | `GOOGLE_CALENDAR_API_KEY` in `app.js`, intentionally public |
| **HTTP referrer allowlisting** | restricting an API key to requests from listed domains | README: the key must be restricted to `pizzacatz.github.io/*` + `localhost:8000/*` in Google Cloud Console |

### Data pipeline (ICS & Apps Script — reference copies, not deployed here)

| Term | Plain meaning | In this project |
|---|---|---|
| **ICS feed / iCalendar (RFC 5545)** | the standard calendar-export text format | the upstream `pokedata.ovh` feed fetched by `ics_formatter.js` |
| **line folding/unfolding** | ICS's rule of wrapping long lines with a leading-space continuation | the manual unfold loop and `_fold()` in `ics_formatter.js` |
| **VEVENT block** | one event's record inside an ICS file | matched via regex (`BEGIN:VEVENT...END:VEVENT`) and rewritten per-event |
| **UID** | an event's unique identifier used to detect "is this the same event" | the dedup key for `Events.import` in `pokemon_calendar_sync*.gs` |
| **idempotent** | safe to re-run without duplicating side effects | the sync's whole design — "re-runs never create duplicates" |
| **create-only sync** | only adds new records, never overwrites existing ones | `pokemon_calendar_sync*.gs`'s doc comment: "once an event exists it is LEFT ALONE" |
| **tombstoning** | remembering a deliberate deletion so it isn't undone by re-sync | "if YOU delete an event... it is remembered and never resurrected" |
| **Advanced Calendar Service** | Apps Script's lower-level Google Calendar API binding | `Events.import`, referenced in `pokemon_calendar_sync*.gs`'s setup instructions |
| **Apps Script trigger** | an automatic handler bound to an event (form submit, edit, schedule) | `onFormSubmit`/`onEdit` in `community_event_form.gs`; the daily time-based trigger in the sync script |
| **status state machine** | a fixed set of named stages a record moves through | `STATUS_VALUES` in `community_event_form.gs`: `PENDING → APPROVED → PUBLISHED`, `REJECTED`, `REMOVE → REMOVED`, `ERROR` |
| **data validation** | a spreadsheet rule restricting a cell to an allowed list | `_ensureColumns()`'s dropdown rule on the Status column |

### Process & deployment

| Term | Plain meaning | In this project |
|---|---|---|
| **CI/CD** | automatically building/deploying on every code push | push to `main` → live site, no manual step |
| **GitHub Actions workflow** | a YAML-defined automation pipeline run by GitHub | `.github/workflows/pages.yml` |
| **concurrency group** | a rule serializing/canceling overlapping automation runs | `concurrency: {group: pages, cancel-in-progress: true}` |
| **deploy artifact** | the packaged output handed to a deploy step | `actions/upload-pages-artifact` uploading the repo `path: .` as-is |
