# PRD: Pokémon Events Calendar (Web App)

## 1. Overview

Build a single-page, public-facing web calendar that displays Pokémon competitive
events pulled from existing Google Calendars. Visitors can switch between calendar
views (month, week, day, list) and filter events by category. The page must look
good and remain usable on mobile.

This is a standalone hobby project. It is NOT embedded inside a larger site.

## 2. Context / Existing Pipeline (do not rebuild)

A Google Apps Script already exists that:
- Reads an ICS feed from `pokedata.ovh`, and
- Sorts those events into **5 separate Google Calendars** by category.

A **6th Google Calendar** will be added for community (non-official) events, maintained
manually in Google Calendar.

This PRD covers ONLY the display web app that reads these 6 calendars. The Apps Script
pipeline is out of scope and must not be modified.

## 3. Tech Stack & Constraints

- **Plain HTML/CSS/JavaScript.** No framework, no build step, no `node_modules`.
  The deliverable is static files (e.g. `index.html` + a JS file + a CSS file) that
  run directly when opened and deploy to **GitHub Pages** with no build pipeline.
- **Calendar library: FullCalendar v6** (standard/MIT edition — free). Load it and its
  Google Calendar plugin via CDN. Pin an exact version in the CDN URL for reproducibility.
  - **Implementer must confirm the exact current CDN URLs and import names from the
    official FullCalendar v6 docs before coding.** Do not guess URLs.
- **Calendar data: Google Calendar plugin** (`@fullcalendar/google-calendar` family).
  Each of the 6 Google Calendars is a separate FullCalendar *event source*.
- **Note / tradeoff:** Earlier hobby apps were dependency-free. This one depends on
  FullCalendar (loaded via CDN). That is an accepted tradeoff for not hand-building a
  calendar engine. The 2000s utility aesthetic is still achieved through custom CSS.

## 4. Data Sources

Six event sources, each with its own color so categories are visually distinguishable.
Calendar IDs and final colors are placeholders to be filled in by the project owner.

| # | Category                     | Google Calendar ID (TO PROVIDE) | Suggested color (finalize) |
|---|------------------------------|----------------------------------|----------------------------|
| 1 | TCG Cups                     | `<id-1>`                         | blue                       |
| 2 | TCG Challenges               | `<id-2>`                         | teal                       |
| 3 | VGC Cups & Challenges        | `<id-3>`                         | red                        |
| 4 | GO Cups & Challenges         | `<id-4>`                         | green                      |
| 5 | TCG Prereleases              | `<id-5>`                         | purple                     |
| 6 | Community Events (unofficial)| `<id-6>`                         | orange                     |

Requirements:
- Each source is defined with its `googleCalendarId` and a per-source class/color so its
  events render in that category's color.
- Adding/removing a source must be a single, isolated change (one entry in the sources
  list) so future categories are easy to add.

## 5. Functional Requirements

### 5.1 Views
- Provide a view switcher with at minimum: **Month (default)**, **Week**, **Day**, **List/Agenda**.
- Month view is the primary, most-used view and must be the initial view on desktop.
- The view switcher controls must be reachable and tappable on mobile.

### 5.2 Filtering
- Provide a filter panel with **one checkbox per category** (6 total), each labeled with
  the category name and shown in that category's color.
- All categories are checked (visible) by default.
- Unchecking a category hides that category's events; rechecking shows them again.
- Filtering must work in every view (month, week, day, list).
- **There is no pre-built filter widget in FullCalendar; this panel and its show/hide
  logic are custom code.** Implementer chooses the mechanism (e.g. toggling the relevant
  event source on/off) and should confirm the exact method names against current docs.

### 5.3 Mobile behavior (high priority)
- The page must be responsive and look good on a phone-width screen (~375–414px wide).
- A full month grid is cramped on a phone. Required behavior: on narrow screens the
  calendar should present a **list/agenda view** instead of the dense month grid, so phone
  users get a scannable list; desktop users keep the month grid.
  - Implementer should use FullCalendar's window-resize hook plus its programmatic
    view-change method to swap views by screen width. **Confirm the exact hook/method
    names in current v6 docs.**
- The filter panel and view controls must remain usable (tappable, not overlapping) at
  phone width — e.g. collapse the filter panel into a toggle if needed.

### 5.4 Event interaction
- Clicking/tapping an event should show its details (title, date/time, and location or
  description if present).
- **Decision needed (see §11):** default behavior is to open a small in-page detail
  popup. Alternative is to link out to the Google Calendar event page. Pick one.

## 6. Visual Design

- Aesthetic: the established **2000s utility look** (Verdana/system fonts, a
  Windows-Luna-style palette, flat panels, visible borders). No heavy modern shadows or
  gradients unless they read as period-appropriate.
- FullCalendar ships default styling; override it with custom CSS so the calendar matches
  the chosen aesthetic rather than looking like a stock embed.
- Category colors (from §4) must be legible against the calendar background in both the
  grid cells and the filter panel.
- Mobile layout is part of "looks good," not an afterthought — see §5.3.

## 7. Security Requirements

- A **Google Calendar API key** is required and will be present in client-side code,
  meaning it is publicly visible in page source. This is expected for this plugin.
- The key **must be restricted** in the Google Cloud Console before launch:
  - Restrict to the **Google Calendar API only** (API restriction).
  - Add an **HTTP referrer restriction** limited to the GitHub Pages domain that will
    host this page (and `localhost` during testing if needed).
- This restriction is a **required launch step**, not optional. A leaked-but-restricted
  key cannot be repurposed for other Google APIs or used from other domains.

## 8. Setup Prerequisites (owner must do before/alongside build)

These are manual steps the project owner performs; the implementer cannot do them:
1. Make all 6 Google Calendars **public** in their Google sharing settings.
   - Confirm the community calendar is acceptable to expose publicly.
2. Create a **Google Calendar API key** (Google Cloud Console → enable Calendar API →
   create API key) and apply the restrictions in §7.
3. Collect each calendar's **Calendar ID** and provide them for §4.

## 9. Out of Scope

- The Apps Script ICS-to-Google-Calendar pipeline (already built; do not touch).
- Creating or editing events (this app is read-only display).
- User accounts, RSVPs, or notifications.
- A build pipeline, bundler, or any server-side backend.

## 10. Acceptance Criteria (definition of done)

The app is done when ALL of the following are true:
1. On desktop, the page loads showing the **month view** by default.
2. Events from **all 6 calendars** appear, each in its assigned category color.
3. The **view switcher** changes between month, week, day, and list, and each renders correctly.
4. Each of the **6 filter checkboxes** correctly hides and re-shows only its own category,
   in every view.
5. On a phone-width screen, the calendar shows the **list/agenda view** automatically, and
   the controls/filter remain usable.
6. A spot-checked event matches the same event in the underlying Google Calendar
   (title, date, time).
7. The API key is restricted to the Calendar API and to the hosting domain.

## 11. Open Questions / Decisions Needed (resolve before or during build)

1. **Calendar IDs** — owner to provide all 6 (§4).
2. **Final colors** — confirm or replace the suggested palette (§4).
3. **Time zone** — VGC/Pokémon events are global. Should event times display in the
   **viewer's local time zone** (proposed default) or a single fixed zone? This affects
   how times read for international visitors. Owner to confirm.
4. **Event click behavior** — in-page detail popup (proposed default) vs. link out to the
   Google Calendar event (§5.4).
5. **Date range / past events** — should past events be visible when navigating back, or
   should the app focus only on upcoming events? Default: standard FullCalendar navigation
   (past events viewable). Confirm if different.
6. **Mobile default view** — list/agenda is proposed for narrow screens. Confirm this is
   the desired mobile experience.

## 12. Notes for the Implementer

- This spec deliberately does NOT pin exact FullCalendar API/method/import names. Several
  were intentionally described behaviorally because they should be confirmed against the
  **current official FullCalendar v6 documentation** rather than assumed. Verify:
  - the CDN URLs / import paths for FullCalendar v6 core, the day-grid/time-grid/list view
    plugins, and the Google Calendar plugin;
  - the event-source definition format for Google Calendar sources;
  - the method to toggle a source's visibility for filtering;
  - the window-resize hook and view-change method for the mobile view swap.
- If anything in this PRD is ambiguous or appears to conflict, stop and flag it before
  implementing rather than guessing.

---

## 13. Addendum — as built (July 2026)

Shipped at https://pizzacatz.github.io/pokemon-calendar-webapp/ (repo
`pizzacatz/pokemon-calendar-webapp`). Everyday documentation lives in
`README.md`; this addendum only records where reality diverged from the spec.

**Resolved decisions (§11):** all 6 calendar IDs wired; event click = in-page
popup; time zone = fixed US Eastern (not viewer-local); past events navigable;
mobile month redesigned (see below).

**Scope changes vs. the original spec:**
- §1 "NOT embedded" was reversed: the app is embedded in carrd.co pages as an
  auto-resizing iframe (`?embed=1`), replacing the old eventscalendar.co
  widgets. A standalone page still works at the same URL.
- §6 the 2000s-utility look was replaced by a dark theme matching the prior
  widget (background `#1A1A1A`, panels `#1F1F1F`, gold `#FFD180` borders).
- §5.1 Day view was dropped; "Week" is a custom day-strip + one-day list view;
  "List" is a rolling 30-day agenda anchored on today.
- §5.3 mobile no longer swaps to list view: month renders dot-per-event cells
  and tapping a day opens a day-list modal.
- §5.2 filter checkboxes became always-visible colored toggle chips with
  shortened labels (VGC, GO, Prereleases, Community).
- Added beyond spec: event graphics (Drive attachments + description image
  URLs) in the popup, Google Maps directions links for locations, location
  junk-tail cleanup, per-embed URL params (`view=`, `cats=`) so each carrd
  page defaults to its own view and category set.
- Added Sept 2026: **copy event details** buttons in the popup, so organisers
  and players can share an event elsewhere — above all in Discord — without
  retyping it. Plain-text copy (title / when / where / link) and a Discord
  copy with the same lines as markdown (bold title, address linked to Google
  Maps directions, "Official event page" linked to the event URL, previews
  suppressed).
