/**
 * Pokémon events -> Google Calendar sync (Google Apps Script)
 *
 * One self-contained script that CLEANS the upstream Play! Pokémon ICS feed and
 * IMPORTS its events into a Google Calendar as real, individually-editable
 * events. That Google Calendar is the source for the eventscalendar.co widget
 * embedded on the carrd.co site.
 *
 *   pokedata.ovh (ICS)  ->  this script (clean + import, daily)  ->  Google Calendar
 *                                                                         |
 *                                          eventscalendar.co widget  <----+
 *                                                     |
 *                                              carrd.co page
 *
 * Cleaning (per event):
 *   - pulls a clean title out of the anchor in DESCRIPTION,
 *   - strips "League", normalizes "@" spacing and whitespace,
 *   - sets the event description to the source URL,
 *   - keeps LOCATION when present.
 *
 * Sync policy:
 *   - Idempotent: keyed on each event's ICS UID via the Advanced Calendar API
 *     (Events.import), so re-runs never create duplicates.
 *   - Create-only: once an event exists it is LEFT ALONE, so your manual edits
 *     to title/time/notes are never clobbered by a later run.
 *   - Auto-remove if untouched: when the source drops an event (e.g. a cancelled
 *     tournament), it is deleted from your calendar ONLY if you never edited it.
 *     If you edited it, it is protected and kept.
 *   - Tombstones: if YOU delete an event that is still in the source feed, it is
 *     remembered and never resurrected on the next run.
 *
 * ----------------------------------------------------------------------------
 * HOW TO RUN THIS IN GOOGLE APPS SCRIPT
 * ----------------------------------------------------------------------------
 * Unlike a web app (the old doGet script), you don't "run the script" — you run
 * a specific FUNCTION. In the editor toolbar there's a dropdown listing every
 * function, next to a "Run" button: pick a function, then click Run.
 *
 * There are two functions you'd ever run by hand:
 *   - syncPokemonEvents()  = THE script. Fetches the feed, cleans it, imports
 *                            events into your calendar. Run this whenever you
 *                            want to sync.
 *   - setupDailyTrigger()  = a ONE-TIME convenience. Run it once to make Google
 *                            run syncPokemonEvents() automatically every day so
 *                            you never have to click Run again. Optional.
 *
 * SETUP (one time):
 *   1. Paste this file into a Google Apps Script project.
 *   2. Left sidebar -> Services (+) -> add "Google Calendar API" (Advanced service).
 *   3. Set CALENDAR_ID below to the calendar the widget reads
 *      (Google Calendar -> Settings for that calendar -> "Calendar ID").
 *
 * FIRST RUN:
 *   4. In the function dropdown (top toolbar), select "syncPokemonEvents".
 *   5. Click Run. Approve the permissions prompt the first time (for your own
 *      script, "Advanced -> Go to project (unsafe)" is normal).
 *   6. Check the Execution log at the bottom (e.g. "created=12 skipped=0 ...")
 *      and confirm the events appear in your Google Calendar.
 *
 * PUT IT ON AUTOPILOT (optional):
 *   7. Select "setupDailyTrigger" in the dropdown and click Run ONCE. It
 *      schedules syncPokemonEvents() to run by itself every morning (~5am).
 *      Skip this if you'd rather run syncPokemonEvents() by hand each time.
 */

// ======= CONFIGURE THIS =======
const CALENDAR_ID = 'REPLACE_WITH_YOUR_CALENDAR_ID'; // e.g. 'abc123@group.calendar.google.com' or your gmail address
const SRC = 'https://pokedata.ovh/events/api/_tcg/cups/challenges/_go/cups/_vg/challenges/_country/US/_state/GA/Georgia/_start/2025-08-20/ics';
const PREFIX = ''; // optional title prefix, e.g. 'TCG '
// Don't auto-remove events that start before this many days ago (avoid churning past events).
const PRUNE_PAST_DAYS = 1;

const PROP_KNOWN = 'sync_knownUids';       // UIDs we have created
const PROP_TOMBSTONES = 'sync_tombstones'; // UIDs the user deleted -> never re-create

/** Install/refresh a daily trigger. Run once. */
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncPokemonEvents')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncPokemonEvents').timeBased().everyDays(1).atHour(5).create();
  Logger.log('Daily trigger installed (≈5am). Now run syncPokemonEvents() once to test.');
}

/** Main entry point. Safe to run repeatedly. */
function syncPokemonEvents() {
  if (CALENDAR_ID === 'REPLACE_WITH_YOUR_CALENDAR_ID') {
    throw new Error('Set CALENDAR_ID at the top of this script first.');
  }

  const props = PropertiesService.getScriptProperties();
  const known = new Set(_readJsonSet(props, PROP_KNOWN));
  const tombstones = new Set(_readJsonSet(props, PROP_TOMBSTONES));

  const res = UrlFetchApp.fetch(SRC, { muteHttpExceptions: true });
  if (res.getResponseCode() >= 400) throw new Error('Upstream error ' + res.getResponseCode());

  const events = _parseVevents(res.getContentText());
  const sourceUids = new Set(events.map(e => e.uid).filter(Boolean));

  let created = 0, skipped = 0, deletedByUser = 0;

  // --- Pass 1: create new events (idempotent, create-only) ---
  for (const ev of events) {
    if (!ev.uid || !ev.start) { skipped++; continue; }
    if (tombstones.has(ev.uid)) { skipped++; continue; } // user deleted it before

    const existing = _findByUid(ev.uid);
    if (existing) { known.add(ev.uid); skipped++; continue; } // already there -> leave it alone

    if (known.has(ev.uid)) {
      // We created it before, the source still lists it, but it's gone now
      // => the user deleted it. Remember that and don't resurrect it.
      tombstones.add(ev.uid);
      known.delete(ev.uid);
      deletedByUser++;
      continue;
    }

    _importEvent(ev);
    known.add(ev.uid);
    created++;
  }

  // --- Pass 2: auto-remove events the source dropped, IF untouched ---
  let removed = 0, protectedKept = 0;
  const managed = _listManagedEvents();
  for (const gEv of managed) {
    const uid = gEv.iCalUID || _cleanUid(gEv);
    if (!uid || sourceUids.has(uid)) continue; // still in feed -> keep
    if (_isUntouched(gEv)) {
      Calendar.Events.remove(CALENDAR_ID, gEv.id);
      known.delete(uid);
      removed++;
    } else {
      protectedKept++; // you edited it -> protect it
    }
  }

  props.setProperty(PROP_KNOWN, JSON.stringify([...known]));
  props.setProperty(PROP_TOMBSTONES, JSON.stringify([...tombstones]));
  Logger.log('Sync done. created=%s skipped=%s removedUntouched=%s protected=%s userDeleted=%s',
    created, skipped, removed, protectedKept, deletedByUser);
}

/* ============================ import / lookup ============================ */

function _importEvent(ev) {
  const startKey = ev.start.date || ev.start.dateTime;
  const endKey = ev.end ? (ev.end.date || ev.end.dateTime) : '';
  const resource = {
    iCalUID: ev.uid,
    summary: ev.summary,
    description: ev.description || '',
    location: ev.location || '',
    start: ev.start,
    end: ev.end || _defaultEnd(ev.start),
    // Fingerprint of what we imported. Used later to tell "untouched" from "edited".
    extendedProperties: {
      private: {
        managedBySync: 'true',
        srcSummary: (ev.summary || '').slice(0, 1000),
        srcStart: String(startKey).slice(0, 200),
        srcEnd: String(endKey).slice(0, 200)
      }
    }
  };
  Calendar.Events.import(resource, CALENDAR_ID);
}

/** Has this managed event been left exactly as we imported it? */
function _isUntouched(gEv) {
  const p = (gEv.extendedProperties && gEv.extendedProperties.private) || {};
  const curStart = (gEv.start && (gEv.start.date || gEv.start.dateTime)) || '';
  const curEnd = (gEv.end && (gEv.end.date || gEv.end.dateTime)) || '';
  return (gEv.summary || '') === (p.srcSummary || '') &&
         curStart === (p.srcStart || '') &&
         curEnd === (p.srcEnd || '');
}

function _findByUid(uid) {
  const r = Calendar.Events.list(CALENDAR_ID, { iCalUID: uid, showDeleted: false, maxResults: 1 });
  return (r.items && r.items.length) ? r.items[0] : null;
}

function _listManagedEvents() {
  const out = [];
  let pageToken = null;
  const timeMin = new Date(Date.now() - PRUNE_PAST_DAYS * 86400000).toISOString();
  do {
    const r = Calendar.Events.list(CALENDAR_ID, {
      privateExtendedProperty: 'managedBySync=true',
      timeMin, showDeleted: false, maxResults: 2500, singleEvents: true, pageToken
    });
    (r.items || []).forEach(i => out.push(i));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

function _cleanUid(gEv) { return gEv.iCalUID ? gEv.iCalUID.replace(/@google\.com$/, '') : ''; }

function _defaultEnd(start) {
  if (start.date) { // all-day -> 1 day
    const d = new Date(start.date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return { date: Utilities.formatDate(d, 'Etc/UTC', 'yyyy-MM-dd') };
  }
  const d = new Date(start.dateTime);
  d.setHours(d.getHours() + 1); // timed -> +1h
  return { dateTime: d.toISOString() };
}

/* ============================ ICS parsing + cleaning ============================ */

function _parseVevents(raw) {
  // Unfold (RFC 5545)
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const unfolded = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) line += lines[++i].replace(/^[ \t]/, '');
    unfolded.push(line);
  }
  const text = unfolded.join('\n');

  const out = [];
  (text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || []).forEach(block => {
    const uid = _match1(block, /^UID(?:;[^:]*)?:(.*)$/mi).trim();
    if (!uid) return;

    // Title cleanup
    const descLine = _match1(block, /^DESCRIPTION(?:;[^:]*)?:(.*)$/mi) || '';
    const { href, inner } = _parseAnchor(descLine);
    let summary = inner || _match1(block, /^SUMMARY(?:;[^:]*)?:(.*)$/mi) || '';
    summary = _unescapeICS(summary).replace(/\bLeague\b/gi, '').replace(/\s*@\s*/g, ' @ ').replace(/\s+/g, ' ').trim();
    if (!/@/.test(summary) && inner) {
      const m = inner.replace(/\bLeague\b/gi, '').split('@');
      if (m.length === 2) summary = (m[0].trim() + ' @ ' + m[1].trim()).replace(/\s+/g, ' ').trim();
    }
    if (PREFIX) summary = (PREFIX + summary).trim();

    const description = (href || _match1(block, /^URL:(.*)$/mi) || '').trim();
    const location = _unescapeICS(_match1(block, /^LOCATION(?:;[^:]*)?:(.*)$/mi)).trim();

    out.push({
      uid,
      summary: summary || '(untitled)',
      description,
      location,
      start: _parseDate(block, 'DTSTART'),
      end: _parseDate(block, 'DTEND')
    });
  });
  return out;
}

/** Returns a Google Calendar API start/end object, or null. */
function _parseDate(block, name) {
  const re = new RegExp('^' + name + '([^:]*):(.*)$', 'mi');
  const m = block.match(re);
  if (!m) return null;
  const params = m[1] || '';
  const val = m[2].trim();

  if (/VALUE=DATE\b/i.test(params) || /^\d{8}$/.test(val)) { // all-day
    return { date: val.slice(0, 4) + '-' + val.slice(4, 6) + '-' + val.slice(6, 8) };
  }
  if (/Z$/.test(val)) { // UTC instant
    return { dateTime: _isoFromBasic(val, true) };
  }
  const tz = (params.match(/TZID=([^;:]+)/i) || [, ''])[1];
  if (tz) return { dateTime: _isoFromBasic(val, false), timeZone: tz };
  // Floating local time -> interpret in the calendar's own zone
  return { dateTime: _isoFromBasic(val, false), timeZone: _calTimeZone() };
}

// '20250820T180000Z' -> '2025-08-20T18:00:00Z' (or without Z for local)
function _isoFromBasic(v, isUtc) {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (!m) return v;
  const base = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6];
  return isUtc ? base + 'Z' : base;
}

let _calTz = null;
function _calTimeZone() {
  if (_calTz) return _calTz;
  try { _calTz = Calendar.Calendars.get(CALENDAR_ID).timeZone || 'Etc/UTC'; }
  catch (e) { _calTz = Session.getScriptTimeZone() || 'Etc/UTC'; }
  return _calTz;
}

/* ============================ small helpers ============================ */

function _readJsonSet(props, key) {
  try { return JSON.parse(props.getProperty(key) || '[]'); } catch (e) { return []; }
}
function _match1(s, re) { const m = String(s).match(re); return m ? m[1] : ''; }
function _parseAnchor(descLine) {
  const href = (descLine.match(/href="([^"]+)"/i) || [, ''])[1];
  let inner = descLine.replace(/.*?>/, '').replace(/<\/a>.*/i, '').replace(/<[^>]*>/g, '');
  return { href, inner: _unescapeICS(inner).trim() };
}
function _unescapeICS(s) { return String(s || '').replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').trim(); }
