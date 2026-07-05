/* =====================================================================
 * Pokémon Events Calendar — display app
 * Plain JS, no build step. Reads 6 public Google Calendars via the
 * FullCalendar v6 Google Calendar plugin and renders them with custom
 * category filtering, a widget-style week view (day strip + one-day list),
 * a rolling upcoming list, and an in-page detail popup.
 * ===================================================================== */

/* ---------------------------------------------------------------------
 * CONFIG — fill these in. (See PRD §4, §7, §8.)
 * ------------------------------------------------------------------- */

// Google Calendar API key. Publicly visible by design — it MUST be restricted
// in Google Cloud Console to (a) the Calendar API only and (b) an HTTP-referrer
// allowlist of your GitHub Pages domain (+ localhost while testing). PRD §7.
const GOOGLE_CALENDAR_API_KEY = 'AIzaSyAAo29uceMZY2Yd2FU9vRlkI_32WDLtTZ0';

// Display time zone for all events. Decision (PRD §11.3): fixed US Eastern.
const DISPLAY_TIME_ZONE = 'America/New_York';

// One entry per category. To add/remove a category, edit ONLY this list (PRD §4).
// Colors are bright variants so they stay legible on the dark background (PRD §6).
const CALENDARS = [
  { id: 'tcg-cups',       label: 'TCG Cups',              color: '#64b5f6', googleCalendarId: '86e309612473b346e0bdec61b2638bf9915dbb5961f924d2d40e69032b56c344@group.calendar.google.com' },
  { id: 'tcg-challenges', label: 'TCG Challenges',        color: '#4dd0e1', googleCalendarId: '1e75db32a0ea41bc4e7e4aa16b3555f5a67cf80ae652c9e6ffc7e18c84302a67@group.calendar.google.com' },
  { id: 'vgc',            label: 'VGC Cups & Challenges', color: '#ef5350', googleCalendarId: '96c9ca92cfdbee45cc3e0cb314ba47c11ef88705bab2f12dca14cefcf24a1706@group.calendar.google.com' },
  { id: 'go',             label: 'GO Cups & Challenges',  color: '#66bb6a', googleCalendarId: '6266d34b4ebc12683acd051f9caac81e9cbdf123505bc6f733a7fe60451804a9@group.calendar.google.com' },
  { id: 'tcg-prerelease', label: 'TCG Prereleases',       color: '#b39ddb', googleCalendarId: '24b6777e29ee1fb3e942d1eea996fc257b099474cfff9ac297a571d73b9c2586@group.calendar.google.com' },
  // 6th calendar — community / unofficial events (maintained manually). PRD §2, §8.
  { id: 'community',      label: 'Community Events',      color: '#ffa726', googleCalendarId: 'df8623bf7aaa7fcaa7cf4e03909f78409895db4819355a5d7b4c396da852aaba@group.calendar.google.com' },
];

/* ---------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------- */

// Build a FullCalendar event-source config from a CALENDARS entry.
function sourceConfig(cal) {
  return {
    id: cal.id,
    googleCalendarId: cal.googleCalendarId,
    color: cal.color,        // event chip background / list-view dot
    textColor: '#1a1a1a',    // dark text on the bright chip colors
    className: 'cat-' + cal.id,
  };
}

function categoryColor(event) {
  const src = CALENDARS.find(function (c) { return c.id === (event.source && event.source.id); });
  return (src && src.color) || event.backgroundColor || '#888';
}

// Strip the upstream feed's junk tail from locations:
//   '3650 SATELLITE BLVD, DULUTH, GA 30096, US, , Duluth/US'
//    -> '3650 SATELLITE BLVD, DULUTH, GA 30096'
function cleanLocation(loc) {
  return String(loc).replace(/,\s*USA?,\s*,\s*[^,]*\/[A-Za-z]{2}\s*$/i, '').trim();
}

// Google Maps directions link for an address (origin = the visitor's location).
function mapsUrl(loc) {
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(loc);
}

function locationLink(loc) {
  const a = document.createElement('a');
  a.href = mapsUrl(loc);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = loc;
  a.title = 'Directions in Google Maps';
  return a;
}

// Today's date (YYYY-MM-DD) in the display time zone.
function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TIME_ZONE }).format(new Date());
}

// Narrow screens get compact treatments (dot month cells, stacked list rows). PRD §5.3.
const NARROW_MAX = 767; // px
function isNarrow() { return window.innerWidth <= NARROW_MAX; }

/* ---------------------------------------------------------------------
 * Calendar
 * ------------------------------------------------------------------- */

let calendar;

function initCalendar() {
  const el = document.getElementById('calendar');

  calendar = new FullCalendar.Calendar(el, {
    timeZone: DISPLAY_TIME_ZONE,
    googleCalendarApiKey: GOOGLE_CALENDAR_API_KEY,

    initialView: 'dayGridMonth',       // month everywhere; mobile gets dot cells. PRD §5.1 / §5.3
    height: 'auto',
    firstDay: 0,
    navLinks: false,
    dayMaxEventRows: 4,                 // overflow into a "+n more" popover in month view

    views: {
      // Widget-style week: FullCalendar renders the whole week as a list;
      // our custom day strip filters it down to one selected day.
      weekStrip:   { type: 'list', duration: { weeks: 1 }, buttonText: 'Week' },
      // Rolling list anchored on "now" (not snapped to the month), so today
      // is always at the top. prev/next page by 30 days.
      listRolling: { type: 'list', duration: { days: 30 }, buttonText: 'List' },
    },

    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,weekStrip,listRolling',
    },
    buttonText: { today: 'Today', month: 'Month' },

    // All six sources start visible (PRD §5.2). Toggled via the filter panel.
    eventSources: CALENDARS.map(sourceConfig),

    // Guard against title-less events (e.g. a calendar shared as free/busy-only)
    // rendering as the literal string "undefined". Drop the Google Calendar URL
    // entirely so nothing (middle-click, ctrl-click) can navigate to it — and
    // clean the junk tail off locations.
    eventDataTransform: function (eventData) {
      if (!eventData.title) eventData.title = '(untitled)';
      delete eventData.url;
      // The Google Calendar plugin puts location/description at the top level
      // of the raw data (FullCalendar folds them into extendedProps later).
      if (eventData.location) eventData.location = cleanLocation(eventData.location);
      if (eventData.extendedProps && eventData.extendedProps.location) {
        eventData.extendedProps.location = cleanLocation(eventData.extendedProps.location);
      }
      return eventData;
    },

    // In-page detail popup instead of navigating to Google (PRD §5.4 / §11.4).
    // On mobile month view, any tap on a day — dots, chips, whatever — goes
    // to the day-list modal, never straight to a single event.
    eventClick: function (info) {
      info.jsEvent.preventDefault();
      if (isNarrow() && calendar.view.type === 'dayGridMonth') {
        openDayModal(calendar.formatIso(info.event.start).slice(0, 10));
      } else {
        openEventModal(info.event);
      }
    },

    // In list rows: inline time under the title (mobile hides the time column
    // and shows this instead), then the location as a Maps directions link.
    eventDidMount: function (info) {
      if (!info.el.classList.contains('fc-list-event')) return;
      const cell = info.el.querySelector('.fc-list-event-title');
      if (!cell) return;

      const timeEl = document.createElement('div');
      timeEl.className = 'event-time-inline';
      timeEl.textContent = formatTimeRange(info.event);
      cell.appendChild(timeEl);

      const loc = info.event.extendedProps && info.event.extendedProps.location;
      if (!loc) return;
      const div = document.createElement('div');
      div.className = 'event-loc';
      const a = locationLink(loc);
      a.addEventListener('click', function (e) { e.stopPropagation(); }); // don't open the popup too
      div.appendChild(a);
      cell.appendChild(div);
    },

    // Keep the day strip, month dots and iframe height in sync with data/navigation.
    datesSet: function () { scheduleDecorUpdate(true); },
    eventsSet: function () { scheduleDecorUpdate(false); },
  });

  calendar.render();
  initDayStrip(el);

  // On phones, month cells show only dots — tapping anywhere in the day cell
  // opens its event-list modal. (Own listener rather than FullCalendar's
  // dateClick so taps on our injected dots and on event elements all count.)
  el.addEventListener('click', function (e) {
    if (!isNarrow() || calendar.view.type !== 'dayGridMonth') return;
    if (e.target.closest('.fc-event')) return;   // handled by eventClick above
    const cell = e.target.closest('.fc-daygrid-day[data-date]');
    if (cell) openDayModal(cell.getAttribute('data-date'));
  });

  // Auto-height for the embedding iframe (carrd) — see postHeight().
  if (window.parent !== window && 'ResizeObserver' in window) {
    new ResizeObserver(postHeight).observe(document.body);
  }
}

// Tell the embedding page (carrd iframe snippet) how tall we are, so the
// iframe can grow instead of showing its own inner scrollbar. Open modals
// are position:fixed (invisible to body height), so measure them too and
// grow the iframe when a long day list wouldn't fit.
function postHeight() {
  if (window.parent === window) return;
  let h = document.body.scrollHeight;
  document.querySelectorAll('.modal-overlay:not([hidden]) .modal-box').forEach(function (box) {
    h = Math.max(h, box.getBoundingClientRect().bottom + 24);
  });
  window.parent.postMessage({ type: 'pokecal:height', height: h }, '*');
}

/* ---------------------------------------------------------------------
 * Modal positioning inside the embed
 * In the auto-grown iframe, position:fixed + centered means "middle of the
 * whole (possibly very tall) embed" — nowhere near what the user tapped.
 * The iframe can't see the parent page's scroll position, but the tap
 * coordinates are exactly where the user is looking: anchor the box there.
 * ------------------------------------------------------------------- */

let lastClickY = 0;
document.addEventListener('click', function (e) {
  lastClickY = e.clientY + window.scrollY;
}, true);

function anchorModal(overlay) {
  const box = overlay.querySelector('.modal-box');
  if (window.parent === window) {          // standalone page: viewport centering is right
    overlay.classList.remove('anchored');
    box.style.marginTop = '';
    return;
  }
  overlay.classList.add('anchored');
  const bh = box.offsetHeight;
  const maxTop = Math.max(12, document.body.scrollHeight - bh - 12);
  box.style.marginTop = Math.min(Math.max(12, lastClickY - bh / 2), maxTop) + 'px';
}

/* ---------------------------------------------------------------------
 * Week view day strip (custom, widget-style)
 * Seven day cells with per-category activity dots; the list below shows
 * only the selected day (rows for other days are hidden).
 * ------------------------------------------------------------------- */

let stripEl = null;
let stripEmptyEl = null;
let stripRoot = null;
let selectedDateStr = null;

function initDayStrip(calendarRoot) {
  stripRoot = calendarRoot;

  stripEl = document.createElement('div');
  stripEl.className = 'day-strip';
  stripEl.hidden = true;

  stripEmptyEl = document.createElement('div');
  stripEmptyEl.className = 'strip-empty';
  stripEmptyEl.textContent = 'No events on this day.';
  stripEmptyEl.hidden = true;

  ensureStripAttached();
  scheduleDecorUpdate(true);
}

// The strip lives between FullCalendar's toolbar and the view. FullCalendar
// re-creates its view harness on view changes, which can leave our elements
// behind/after it — so verify the position (not just attachment) and move
// them back into place whenever they've drifted.
function ensureStripAttached() {
  const harness = stripRoot.querySelector('.fc-view-harness');
  if (!harness) return;
  if (stripEl.nextElementSibling !== stripEmptyEl || stripEmptyEl.nextElementSibling !== harness) {
    harness.parentNode.insertBefore(stripEl, harness);
    harness.parentNode.insertBefore(stripEmptyEl, harness);
  }
}

// FullCalendar may not have flushed the DOM when datesSet/eventsSet fire;
// defer one tick before (re)building our decorations on top of it.
function scheduleDecorUpdate(navigated) {
  setTimeout(function () {
    updateStrip(navigated);
    updateMonthDots();
    postHeight();
  }, 0);
}

function updateStrip(navigated) {
  if (!stripEl || !calendar) return;
  ensureStripAttached();
  const isWeek = calendar.view.type === 'weekStrip';
  stripEl.hidden = !isWeek;
  if (!isWeek) { stripEmptyEl.hidden = true; return; }

  const days = weekDays();
  // On navigation, snap the selection to today when visible, else the week start.
  if (navigated || !days.includes(selectedDateStr)) {
    const today = todayStr();
    selectedDateStr = days.includes(today) ? today : days[0];
  }

  renderStripCells(days, dotColorsByDay(days));
  applyDayFilter();
}

// The 7 dates (YYYY-MM-DD) of the displayed week.
function weekDays() {
  const startIso = calendar.formatIso(calendar.view.currentStart).slice(0, 10);
  const base = new Date(startIso + 'T00:00:00Z'); // pure UTC math — no DST surprises
  const days = [];
  for (let i = 0; i < 7; i++) {
    days.push(new Date(base.valueOf() + i * 86400000).toISOString().slice(0, 10));
  }
  return days;
}

// [startDate, endDate] (inclusive, YYYY-MM-DD) that an event spans.
function eventSpan(ev) {
  const s = calendar.formatIso(ev.start).slice(0, 10);
  // end is exclusive; pull back 1ms so a midnight end doesn't bleed into the next day
  const e = ev.end ? calendar.formatIso(new Date(ev.end.valueOf() - 1)).slice(0, 10) : s;
  return [s, e < s ? s : e];
}

// Map each day of the week -> category colors of the events on it.
function dotColorsByDay(days) {
  const dots = {};
  calendar.getEvents().forEach(function (ev) {
    if (!ev.start) return;
    const span = eventSpan(ev);
    const color = categoryColor(ev);
    days.forEach(function (d) {
      if (d >= span[0] && d <= span[1]) (dots[d] = dots[d] || []).push(color);
    });
  });
  return dots;
}

/* ---------------------------------------------------------------------
 * Mobile month dots + tap-a-day modal
 * On narrow screens the month grid hides event chips (CSS) and shows one
 * dot per event instead; tapping the day lists its events in a modal.
 * ------------------------------------------------------------------- */

const MAX_CELL_DOTS = 4;

function updateMonthDots() {
  if (!calendar || calendar.view.type !== 'dayGridMonth') return;

  const cells = document.querySelectorAll('#calendar .fc-daygrid-day[data-date]');
  if (!cells.length) return;

  // Colors per visible day (single pass over events).
  const dots = {};
  calendar.getEvents().forEach(function (ev) {
    if (!ev.start) return;
    const span = eventSpan(ev);
    const color = categoryColor(ev);
    // walk the span day by day (bounded — spans are at most a few days here)
    let d = new Date(span[0] + 'T00:00:00Z');
    for (let i = 0; i < 62; i++) {
      const ds = d.toISOString().slice(0, 10);
      if (ds > span[1]) break;
      (dots[ds] = dots[ds] || []).push(color);
      d = new Date(d.valueOf() + 86400000);
    }
  });

  cells.forEach(function (cell) {
    const ds = cell.getAttribute('data-date');
    let holder = cell.querySelector('.day-dots');
    if (!holder) {
      holder = document.createElement('span');
      holder.className = 'day-dots';
      const frame = cell.querySelector('.fc-daygrid-day-frame') || cell;
      frame.appendChild(holder);
    }
    holder.textContent = '';
    (dots[ds] || []).slice(0, MAX_CELL_DOTS).forEach(function (color) {
      const i = document.createElement('i');
      i.style.background = color;
      holder.appendChild(i);
    });
  });
}

// All events on a given date, sorted (all-day first, then by start time).
function eventsOnDate(dateStr) {
  return calendar.getEvents()
    .filter(function (ev) {
      if (!ev.start) return false;
      const span = eventSpan(ev);
      return dateStr >= span[0] && dateStr <= span[1];
    })
    .sort(function (a, b) {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a.start.valueOf() - b.start.valueOf();
    });
}

const dayModal = { overlay: null, title: null, list: null };

function initDayModal() {
  dayModal.overlay = document.getElementById('day-modal');
  dayModal.title   = document.getElementById('day-modal-title');
  dayModal.list    = document.getElementById('day-modal-list');

  document.getElementById('day-modal-close').addEventListener('click', closeDayModal);
  dayModal.overlay.addEventListener('click', function (e) {
    if (e.target === dayModal.overlay) closeDayModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !dayModal.overlay.hidden) closeDayModal();
  });
}

function openDayModal(dateStr) {
  const date = new Date(dateStr + 'T00:00:00Z');
  dayModal.title.textContent = date.toLocaleDateString(undefined,
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  dayModal.list.textContent = '';
  const events = eventsOnDate(dateStr);
  if (!events.length) {
    const p = document.createElement('p');
    p.className = 'day-item-empty';
    p.textContent = 'No events on this day.';
    dayModal.list.appendChild(p);
  }
  events.forEach(function (ev) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'day-item';

    const title = document.createElement('span');
    title.className = 'day-item-title';
    const dot = document.createElement('i');
    dot.style.background = categoryColor(ev);
    title.appendChild(dot);
    title.appendChild(document.createTextNode(ev.title || '(untitled)'));

    const time = document.createElement('span');
    time.className = 'day-item-time';
    time.textContent = formatTimeRange(ev);

    item.appendChild(title);
    item.appendChild(time);
    item.addEventListener('click', function () {
      closeDayModal();
      openEventModal(ev);       // tap through to the full details popup
    });
    dayModal.list.appendChild(item);
  });

  dayModal.overlay.hidden = false;
  anchorModal(dayModal.overlay);
  postHeight();
}

function closeDayModal() {
  dayModal.overlay.hidden = true;
  postHeight();
}

function renderStripCells(days, dots) {
  const today = todayStr();
  stripEl.textContent = '';
  days.forEach(function (d) {
    const date = new Date(d + 'T00:00:00Z');
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'strip-day'
      + (d === selectedDateStr ? ' selected' : '')
      + (d === today ? ' is-today' : '');
    cell.addEventListener('click', function () {
      selectedDateStr = d;
      renderStripCells(days, dots);
      applyDayFilter();
    });

    const dow = document.createElement('span');
    dow.className = 'strip-dow';
    dow.textContent = date.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });

    const num = document.createElement('span');
    num.className = 'strip-num';
    num.textContent = String(date.getUTCDate());

    const dotsEl = document.createElement('span');
    dotsEl.className = 'strip-dots';
    (dots[d] || []).slice(0, 4).forEach(function (color) {
      const i = document.createElement('i');
      i.style.background = color;
      dotsEl.appendChild(i);
    });

    cell.appendChild(dow);
    cell.appendChild(num);
    cell.appendChild(dotsEl);
    stripEl.appendChild(cell);
  });
}

// Hide list rows for every day except the selected one. The strip itself
// conveys the date, so the per-day header rows are hidden too.
function applyDayFilter() {
  if (calendar.view.type !== 'weekStrip') return;
  let current = null;
  let visible = 0;
  document.querySelectorAll('#calendar .fc-list-table tr').forEach(function (tr) {
    if (tr.classList.contains('fc-list-day')) {
      current = tr.getAttribute('data-date');
      tr.style.display = 'none';
    } else {
      const show = current === selectedDateStr;
      tr.style.display = show ? '' : 'none';
      if (show) visible++;
    }
  });
  stripEmptyEl.hidden = visible > 0;
}

/* ---------------------------------------------------------------------
 * Filter panel (custom — FullCalendar has no built-in filter widget). PRD §5.2
 * Toggling = remove / re-add the event source, so it works in every view.
 * ------------------------------------------------------------------- */

function buildFilterPanel() {
  const list = document.getElementById('filter-list');

  CALENDARS.forEach(function (cal) {
    const label = document.createElement('label');
    label.className = 'filter-item';
    label.style.setProperty('--cat-color', cal.color);

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;                 // all visible by default
    cb.dataset.calId = cal.id;
    cb.addEventListener('change', function () { onFilterChange(cal, cb.checked); });

    const text = document.createElement('span');
    text.className = 'filter-text';
    text.textContent = cal.label;

    label.appendChild(cb);
    label.appendChild(text);
    list.appendChild(label);
  });

  // Mobile: collapse the panel behind a toggle button.
  const toggle = document.getElementById('filter-toggle');
  toggle.addEventListener('click', function () {
    const open = list.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}

function onFilterChange(cal, checked) {
  const existing = calendar.getEventSourceById(cal.id);
  if (checked) {
    if (!existing) calendar.addEventSource(sourceConfig(cal));
  } else {
    if (existing) existing.remove();
  }
}

/* ---------------------------------------------------------------------
 * Event detail popup
 * ------------------------------------------------------------------- */

const modal = {
  overlay: null, title: null, swatch: null,
  whenRow: null, when: null,
  whereRow: null, where: null,
  linkRow: null, link: null,
  media: null,
};

function initModal() {
  modal.overlay  = document.getElementById('event-modal');
  modal.title    = document.getElementById('modal-title');
  modal.swatch   = document.getElementById('modal-swatch');
  modal.whenRow  = document.getElementById('modal-when-row');
  modal.when     = document.getElementById('modal-when');
  modal.whereRow = document.getElementById('modal-where-row');
  modal.where    = document.getElementById('modal-where');
  modal.linkRow  = document.getElementById('modal-link-row');
  modal.link     = document.getElementById('modal-link');
  modal.media    = document.getElementById('modal-media');

  document.getElementById('modal-close').addEventListener('click', closeEventModal);
  modal.overlay.addEventListener('click', function (e) {
    if (e.target === modal.overlay) closeEventModal();   // click backdrop to dismiss
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.overlay.hidden) closeEventModal();
  });
}

// NOTE: with a named timeZone and no timezone plugin, FullCalendar exposes
// event dates as "fake UTC" — the Date's UTC fields hold the Eastern wall
// time. So format with timeZone:'UTC' and label the zone ourselves.
const FAKE_UTC = { timeZone: 'UTC' };
const DATE_OPTS = Object.assign({ weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }, FAKE_UTC);
const TIME_OPTS = Object.assign({ hour: 'numeric', minute: '2-digit' }, FAKE_UTC);

function formatWhen(event) {
  const start = event.start;
  const end = event.end;
  if (!start) return '';

  const dateStr = start.toLocaleDateString(undefined, DATE_OPTS);
  if (event.allDay) return dateStr;

  let s = dateStr + ', ' + start.toLocaleTimeString(undefined, TIME_OPTS);
  if (end) {
    const sameDay = start.toLocaleDateString(undefined, FAKE_UTC) === end.toLocaleDateString(undefined, FAKE_UTC);
    s += ' – ' + (sameDay
      ? end.toLocaleTimeString(undefined, TIME_OPTS)
      : end.toLocaleDateString(undefined, DATE_OPTS) + ', ' + end.toLocaleTimeString(undefined, TIME_OPTS));
  }
  return s + ' ET';
}

// Compact "6:00 PM – 9:00 PM" (or "All day") for the day-modal rows.
function formatTimeRange(event) {
  if (event.allDay || !event.start) return 'All day';
  let s = event.start.toLocaleTimeString(undefined, TIME_OPTS);
  if (event.end) s += ' – ' + event.end.toLocaleTimeString(undefined, TIME_OPTS);
  return s;
}

function openEventModal(event) {
  modal.title.textContent = event.title || '(untitled event)';
  modal.swatch.style.background = categoryColor(event);
  modal.when.textContent = formatWhen(event);

  // Location -> Google Maps directions link.
  const loc = event.extendedProps && event.extendedProps.location;
  if (loc) {
    modal.where.textContent = '';
    modal.where.appendChild(locationLink(loc));
    modal.whereRow.hidden = false;
  } else {
    modal.whereRow.hidden = true;
  }

  // Show the event's full description in the popup (never the Google Calendar
  // link — everything important stays in the widget). URLs inside the
  // description become clickable links.
  modal.media.textContent = '';   // reset graphics from any previously shown event

  const desc = (event.extendedProps && event.extendedProps.description) || '';
  if (desc.trim()) {
    renderDescription(modal.link, desc);
    modal.linkRow.hidden = false;
  } else {
    modal.linkRow.hidden = true;
  }

  // Graphics: Drive files attached to the event, plus any image URLs found
  // in the description (renderDescription puts those in modal.media too).
  renderAttachments(modal.media, (event.extendedProps && event.extendedProps.attachments) || []);

  modal.overlay.hidden = false;
  anchorModal(modal.overlay);
  postHeight();
}

/* ------------------------- event graphics ------------------------- */

function isImageUrl(url) {
  return /\.(png|jpe?g|gif|webp|avif)(\?[^\s]*)?$/i.test(url);
}

// Extract the Drive file id from an attachment ({fileId} or its fileUrl).
function driveFileId(att) {
  if (att.fileId) return att.fileId;
  const m = String(att.fileUrl || '').match(/[?&]id=([\w-]+)|\/d\/([\w-]+)/);
  return m ? (m[1] || m[2]) : '';
}

function appendImage(container, src, href, alt) {
  const a = document.createElement('a');
  a.href = href || src;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt || 'Event image';
  img.loading = 'lazy';
  img.addEventListener('load', postHeight);   // grow the iframe once it arrives
  // If the image can't load (e.g. Drive file not shared publicly),
  // fall back to a plain link instead of a broken image.
  img.addEventListener('error', function () {
    a.textContent = (alt || 'Attachment') + ' ↗';
  });
  a.appendChild(img);
  container.appendChild(a);
}

// Render the event's Drive attachments: images inline (via Drive's public
// thumbnail endpoint — the file must be shared "anyone with the link"),
// anything else as a titled link.
function renderAttachments(container, attachments) {
  // (renderDescription may already have added description images; keep them.)
  attachments.forEach(function (att) {
    const id = driveFileId(att);
    const isImage = /^image\//.test(att.mimeType || '') && id;
    if (isImage) {
      appendImage(container, 'https://drive.google.com/thumbnail?id=' + id + '&sz=w800',
        att.fileUrl, att.title);
    } else if (att.fileUrl) {
      const a = document.createElement('a');
      a.href = att.fileUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = (att.title || 'Attachment') + ' ↗';
      container.appendChild(a);
    }
  });
}

function closeEventModal() {
  modal.overlay.hidden = true;
  postHeight();
}

// Render description text into `container`: strips any HTML Google may have
// stored, keeps line breaks, and turns bare URLs into links.
function renderDescription(container, text) {
  const clean = String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .trim();

  container.textContent = '';
  clean.split(/(https?:\/\/[^\s"'<>]+)/g).forEach(function (part) {
    if (/^https?:\/\//.test(part)) {
      if (isImageUrl(part)) {
        // Direct image URLs in the description render as inline graphics.
        appendImage(modal.media, part);
        return;
      }
      const a = document.createElement('a');
      a.href = part;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      // Long raw URLs are noise; show a friendly label instead.
      a.textContent = 'Event details ↗';
      a.title = part;
      container.appendChild(a);
    } else if (part) {
      container.appendChild(document.createTextNode(part));
    }
  });
}

/* ---------------------------------------------------------------------
 * Boot
 * ------------------------------------------------------------------- */

// Embed mode (?embed=1): hides the page header/footer so the calendar can be
// iframed as a bare widget (e.g. in a carrd.co Embed element).
if (new URLSearchParams(window.location.search).has('embed')) {
  document.documentElement.classList.add('embed');
}

document.addEventListener('DOMContentLoaded', function () {
  if (GOOGLE_CALENDAR_API_KEY.indexOf('REPLACE_ME') === 0) {
    console.warn('[Pokémon Calendar] Set GOOGLE_CALENDAR_API_KEY in app.js — events will not load until you do.');
  }
  buildFilterPanel();
  initModal();
  initDayModal();
  initCalendar();
});
