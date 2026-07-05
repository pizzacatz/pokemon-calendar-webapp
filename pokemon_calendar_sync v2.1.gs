/**
 * Pokémon events -> Google Calendars sync (Google Apps Script)
 *
 * One self-contained script that CLEANS the upstream Play! Pokémon ICS feeds and
 * IMPORTS their events into SEVERAL Google Calendars (one per event category) as
 * real, individually-editable events. Those calendars are the sources for the
 * eventscalendar.co widget(s) embedded on the carrd.co site.
 *
 *   pokedata.ovh (ICS, one filtered feed per calendar)
 *        -> this script (clean + import, daily)
 *        -> 5 Google Calendars (TCG Cups, TCG Challenges, VGC, GO, TCG Prerelease)
 *        -> eventscalendar.co widget(s) -> carrd.co page
 *
 * Each calendar is configured in the FEEDS list below: its own calendar ID, its
 * own pokedata filter, and its own title prefix. The script loops over all of
 * them in one run, with independent dedup/tombstone state per calendar.
 *
 * Cleaning (per event):
 *   - pulls a clean title out of the anchor in DESCRIPTION,
 *   - strips "League", normalizes "@" spacing and whitespace,
 *   - sets the event description to the source URL,
 *   - keeps LOCATION when present.
 *
 * Sync policy (per calendar):
 *   - Idempotent: keyed on each event's ICS UID via the Advanced Calendar API
 *     (Events.import), so re-runs never create duplicates.
 *   - Create-only: once an event exists it is LEFT ALONE, so your manual edits
 *     are never clobbered by a later run.
 *   - Auto-remove if untouched: when the source drops an event, it is deleted
 *     ONLY if you never edited it. Edited events are protected and kept.
 *   - Tombstones: if YOU delete an event that is still in the feed, it is
 *     remembered and never resurrected.
 *
 * ----------------------------------------------------------------------------
 * HOW TO RUN THIS IN GOOGLE APPS SCRIPT
 * ----------------------------------------------------------------------------
 * You run a FUNCTION, not "the script". In the editor toolbar there's a dropdown
 * listing every function next to a "Run" button: pick one, then click Run.
 *
 *   - syncPokemonEvents()  = THE script. Syncs ALL calendars in the FEEDS list.
 *                            Run this whenever you want to sync.
 *   - setupDailyTrigger()  = a ONE-TIME convenience. Run once to make Google run
 *                            syncPokemonEvents() automatically every day.
 *
 * SETUP (one time):
 *   1. Paste this file into a Google Apps Script project.
 *   2. Left sidebar -> Services (+) -> add "Google Calendar API" (Advanced service).
 *   3. Create your 5 Google Calendars (or reuse existing ones). For each, copy
 *      its ID from Google Calendar -> calendar Settings -> "Calendar ID".
 *   4. Paste each ID into the matching FEEDS entry below.
 *
 * FIRST RUN:
 *   5. In the function dropdown (top toolbar), select "syncPokemonEvents".
 *   6. Click Run. Approve the permissions prompt the first time. (If "Something
 *      went wrong" appears during authorization, try an Incognito window signed
 *      into only the Google account that owns the calendars.)
 *   7. Check the Execution log — each calendar prints a line like
 *      "[TCG Cups] created=12 skipped=0 ...". Confirm events appear.
 *
 * PUT IT ON AUTOPILOT (optional):
 *   8. Select "setupDailyTrigger" and click Run ONCE.
 */

// ======= CONFIGURE THIS =======

// Shared location/time filters — identical for every calendar.
const COUNTRY = 'US';
const STATE = 'GA';           // pokedata state code
const STATE_NAME = 'Georgia';
const START = '2025-08-20';   // include events from this date onward

// One entry per calendar. Set each `calendarId` to its own Google Calendar ID.
//   game:  pokedata game token ('_tcg', '_vg', '_go')
//   types: pokedata event-type tokens for that calendar (e.g. ['cups'])
//   prefix: optional text prepended to every title on that calendar ('' for none)
const FEEDS = [
  { key: 'tcg_cups',       label: 'TCG Cups',       calendarId: '86e309612473b346e0bdec61b2638bf9915dbb5961f924d2d40e69032b56c344@group.calendar.google.com', game: '_tcg', types: ['cups'],                prefix: 'TCG ' },
  { key: 'tcg_challenges', label: 'TCG Challenges', calendarId: '1e75db32a0ea41bc4e7e4aa16b3555f5a67cf80ae652c9e6ffc7e18c84302a67@group.calendar.google.com', game: '_tcg', types: ['challenges'],          prefix: 'TCG ' },
  { key: 'vgc',            label: 'VGC',            calendarId: '96c9ca92cfdbee45cc3e0cb314ba47c11ef88705bab2f12dca14cefcf24a1706@group.calendar.google.com', game: '_vg',  types: ['cups', 'challenges'],  prefix: 'VGC ' },
  { key: 'go',             label: 'GO',             calendarId: '6266d34b4ebc12683acd051f9caac81e9cbdf123505bc6f733a7fe60451804a9@group.calendar.google.com', game: '_go',  types: ['cups', 'challenges'],  prefix: 'GO '  },
  { key: 'tcg_prerelease', label: 'TCG Prerelease', calendarId: '24b6777e29ee1fb3e942d1eea996fc257b099474cfff9ac297a571d73b9c2586@group.calendar.google.com', game: '_tcg', types: ['pre'],                 prefix: 'TCG ' }
];

const PRUNE_PAST_DAYS = 1; // don't auto-remove events that started before this many days ago

/** Install/refresh a daily trigger. Run once. */
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncPokemonEvents')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncPokemonEvents').timeBased().everyDays(1).atHour(5).create();
  Logger.log('Daily trigger installed (≈5am). Now run syncPokemonEvents() once to test.');
}

/** Main entry point — syncs every calendar in FEEDS. Safe to run repeatedly. */
function syncPokemonEvents() {
  const props = PropertiesService.getScriptProperties();
  FEEDS.forEach(cfg => {
    if (String(cfg.calendarId).indexOf('REPLACE_') === 0) {
      Logger.log('[%s] skipped — calendarId not set yet', cfg.label);
      return;
    }
    try {
      _syncOne(cfg, props);
    } catch (e) {
      Logger.log('[%s] ERROR: %s', cfg.label, e && e.message ? e.message : e);
    }
  });
}

/* ============================ per-calendar sync ============================ */

function _syncOne(cfg, props) {
  const KNOWN = 'sync_known_' + cfg.key;
  const TOMB = 'sync_tomb_' + cfg.key;
  const known = new Set(_readJsonSet(props, KNOWN));
  const tombstones = new Set(_readJsonSet(props, TOMB));

  const res = UrlFetchApp.fetch(_feedUrl(cfg), { muteHttpExceptions: true });
  if (res.getResponseCode() >= 400) throw new Error('Upstream error ' + res.getResponseCode());

  const events = _parseVevents(res.getContentText(), cfg);
  const sourceUids = new Set(events.map(e => e.uid).filter(Boolean));

  let created = 0, skipped = 0, deletedByUser = 0;

  // --- Pass 1: create new events (idempotent, create-only) ---
  for (const ev of events) {
    if (!ev.uid || !ev.start) { skipped++; continue; }
    if (tombstones.has(ev.uid)) { skipped++; continue; }

    const existing = _findByUid(cfg.calendarId, ev.uid);
    if (existing) { known.add(ev.uid); skipped++; continue; }

    if (known.has(ev.uid)) {
      // We created it before, the source still lists it, but it's gone now
      // => the user deleted it. Remember and don't resurrect.
      tombstones.add(ev.uid);
      known.delete(ev.uid);
      deletedByUser++;
      continue;
    }

    _importEvent(cfg, ev);
    known.add(ev.uid);
    created++;
  }

  // --- Pass 2: auto-remove events the source dropped, IF untouched ---
  let removed = 0, protectedKept = 0;
  const managed = _listManagedEvents(cfg.calendarId);
  for (const gEv of managed) {
    const uid = gEv.iCalUID || _cleanUid(gEv);
    if (!uid || sourceUids.has(uid)) continue;
    if (_isUntouched(gEv)) {
      Calendar.Events.remove(cfg.calendarId, gEv.id);
      known.delete(uid);
      removed++;
    } else {
      protectedKept++;
    }
  }

  props.setProperty(KNOWN, JSON.stringify([...known]));
  props.setProperty(TOMB, JSON.stringify([...tombstones]));
  Logger.log('[%s] created=%s skipped=%s removedUntouched=%s protected=%s userDeleted=%s',
    cfg.label, created, skipped, removed, protectedKept, deletedByUser);
}

function _feedUrl(cfg) {
  return 'https://pokedata.ovh/events/api/' + cfg.game + '/' + cfg.types.join('/') +
    '/_country/' + COUNTRY + '/_state/' + STATE + '/' + STATE_NAME + '/_start/' + START + '/ics';
}

/* ============================ import / lookup ============================ */

function _importEvent(cfg, ev) {
  const startKey = ev.start.date || ev.start.dateTime;
  const endKey = ev.end ? (ev.end.date || ev.end.dateTime) : '';
  const resource = {
    iCalUID: ev.uid,
    summary: ev.summary,
    description: ev.description || '',
    location: ev.location || '',
    start: ev.start,
    end: ev.end || _defaultEnd(ev.start),
    extendedProperties: {
      private: {
        managedBySync: 'true',
        srcSummary: (ev.summary || '').slice(0, 1000),
        srcStart: String(startKey).slice(0, 200),
        srcEnd: String(endKey).slice(0, 200)
      }
    }
  };
  Calendar.Events.import(resource, cfg.calendarId);
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

function _findByUid(calendarId, uid) {
  const r = Calendar.Events.list(calendarId, { iCalUID: uid, showDeleted: false, maxResults: 1 });
  return (r.items && r.items.length) ? r.items[0] : null;
}

function _listManagedEvents(calendarId) {
  const out = [];
  let pageToken = null;
  const timeMin = new Date(Date.now() - PRUNE_PAST_DAYS * 86400000).toISOString();
  do {
    const r = Calendar.Events.list(calendarId, {
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
  if (start.date) {
    const d = new Date(start.date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return { date: Utilities.formatDate(d, 'Etc/UTC', 'yyyy-MM-dd') };
  }
  const d = new Date(start.dateTime);
  d.setHours(d.getHours() + 1);
  return { dateTime: d.toISOString() };
}

/* ============================ ICS parsing + cleaning ============================ */

function _parseVevents(raw, cfg) {
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

    const descLine = _match1(block, /^DESCRIPTION(?:;[^:]*)?:(.*)$/mi) || '';
    const { href, inner } = _parseAnchor(descLine);
    let summary = inner || _match1(block, /^SUMMARY(?:;[^:]*)?:(.*)$/mi) || '';
    summary = _unescapeICS(summary).replace(/\bLeague\b/gi, '').replace(/\s*@\s*/g, ' @ ').replace(/\s+/g, ' ').trim();
    if (!/@/.test(summary) && inner) {
      const m = inner.replace(/\bLeague\b/gi, '').split('@');
      if (m.length === 2) summary = (m[0].trim() + ' @ ' + m[1].trim()).replace(/\s+/g, ' ').trim();
    }
    if (cfg.prefix) summary = (cfg.prefix + summary).trim();

    const description = (href || _match1(block, /^URL:(.*)$/mi) || '').trim();
    const location = _unescapeICS(_match1(block, /^LOCATION(?:;[^:]*)?:(.*)$/mi)).trim();

    out.push({
      uid,
      summary: summary || '(untitled)',
      description,
      location,
      start: _parseDate(block, 'DTSTART', cfg.calendarId),
      end: _parseDate(block, 'DTEND', cfg.calendarId)
    });
  });
  return out;
}

function _parseDate(block, name, calendarId) {
  const re = new RegExp('^' + name + '([^:]*):(.*)$', 'mi');
  const m = block.match(re);
  if (!m) return null;
  const params = m[1] || '';
  const val = m[2].trim();

  if (/VALUE=DATE\b/i.test(params) || /^\d{8}$/.test(val)) {
    return { date: val.slice(0, 4) + '-' + val.slice(4, 6) + '-' + val.slice(6, 8) };
  }
  if (/Z$/.test(val)) {
    return { dateTime: _isoFromBasic(val, true) };
  }
  const tz = (params.match(/TZID=([^;:]+)/i) || [, ''])[1];
  if (tz) return { dateTime: _isoFromBasic(val, false), timeZone: tz };
  return { dateTime: _isoFromBasic(val, false), timeZone: _calTimeZone(calendarId) };
}

function _isoFromBasic(v, isUtc) {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (!m) return v;
  const base = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6];
  return isUtc ? base + 'Z' : base;
}

const _tzCache = {};
function _calTimeZone(calendarId) {
  if (_tzCache[calendarId]) return _tzCache[calendarId];
  let tz;
  try { tz = Calendar.Calendars.get(calendarId).timeZone || 'Etc/UTC'; }
  catch (e) { tz = Session.getScriptTimeZone() || 'Etc/UTC'; }
  _tzCache[calendarId] = tz;
  return tz;
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
