/**
 * Community event submissions -> Google Calendar (Google Apps Script)
 *
 * Publishes events submitted through a public Google Form onto the Community
 * Events calendar, with a moderation step so nothing goes live until the
 * owner approves it in the response sheet.
 *
 *   Google Form  ->  linked "Form Responses" sheet  ->  THIS SCRIPT
 *     - on submit: row gets Status=PENDING, owner gets a notification email
 *     - owner sets Status=APPROVED (dropdown)      -> event is created
 *     - owner sets Status=REMOVE on a published row -> event is deleted
 *
 * The public web calendar (pokemon-calendar-webapp) needs no changes: the
 * community calendar is already one of its sources. Links and image URLs in
 * the description render in the event popup automatically.
 *
 * ----------------------------------------------------------------------------
 * SETUP (one time)
 * ----------------------------------------------------------------------------
 * 1. Create the Google Form with question titles matching the Q map below
 *    EXACTLY (see README "Community event submissions" for the full list).
 * 2. Form -> Responses -> Link to Sheets -> create the response spreadsheet.
 * 3. In that spreadsheet: Extensions -> Apps Script -> paste this file.
 * 4. Project Settings (gear icon) -> Time zone -> America/New_York.
 *    (Event times are interpreted in the script's time zone.)
 * 5. Fill in the CONFIG below, then run setup() once from the toolbar and
 *    approve the permissions prompt.
 * 6. Submit a test response, check the email arrives, set its Status to
 *    APPROVED, and confirm the event appears on the calendar + widget.
 *
 * MODERATION (day to day)
 *   PENDING    new submission, not on the calendar
 *   APPROVED   you approve it -> script publishes it, sets PUBLISHED
 *   PUBLISHED  live on the calendar (Event ID column filled in)
 *   REJECTED   you decline it; nothing happens
 *   REMOVE     set on a PUBLISHED row -> script deletes the event, sets REMOVED
 *
 * If an edit ever doesn't take effect, use the "Community events" menu in the
 * sheet: "Process all rows now" re-sweeps everything (also installed by setup).
 */

// ======= CONFIG =======

const COMMUNITY_CALENDAR_ID = 'df8623bf7aaa7fcaa7cf4e03909f78409895db4819355a5d7b4c396da852aaba@group.calendar.google.com';
const NOTIFY_EMAIL = 'yidojang@gmail.com';   // submission notifications go here
const AUTO_APPROVE = false;                  // true = skip moderation (not recommended)
const DEFAULT_DURATION_HOURS = 2;            // used when no end time is given

// Form question titles -> must match the form EXACTLY (including case).
const Q = {
  game:      'Game',            // e.g. TCG / VGC / GO — used as a title prefix
  name:      'Event name',
  date:      'Event Date',
  start:     'Start Time',
  end:       'End Time',
  venue:     'Venue name',
  address:   'Venue Address',
  description: 'Description',
  link:      'Event link',
  image:     'Image url',
};

// Extra columns this script manages in the response sheet.
const STATUS_COL = 'Status';
const EVENT_ID_COL = 'Event ID';
const STATUS_VALUES = ['PENDING', 'APPROVED', 'PUBLISHED', 'REJECTED', 'REMOVE', 'REMOVED', 'ERROR'];

// ======= ONE-TIME SETUP =======

/** Run once from the editor. Installs triggers and the Status/Event ID columns. */
function setup() {
  const sheet = _responseSheet();
  _ensureColumns(sheet);

  // Times are interpreted per-time-zone in three places (sheet, script,
  // calendar). Align the sheet automatically; the script's own zone can only
  // be set in the editor, so shout if it's wrong.
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone('America/New_York');
  if (Session.getScriptTimeZone() !== 'America/New_York') {
    Logger.log('*** WARNING: script time zone is %s. Set it to America/New_York in ' +
      'Project Settings (gear icon) or event times will be shifted. ***',
      Session.getScriptTimeZone());
  }

  ScriptApp.getProjectTriggers()
    .filter(t => ['handleFormSubmit', 'handleEdit'].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('handleFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('handleEdit').forSpreadsheet(ss).onEdit().create();

  Logger.log('Setup complete. Submit a test form response to verify.');
}

/** Adds a convenience menu when the sheet is opened. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Community events')
    .addItem('Process all rows now', 'processAllRows')
    .addToUi();
}

// ======= TRIGGERS =======

/** New form submission: mark PENDING (or publish immediately if AUTO_APPROVE). */
function handleFormSubmit(e) {
  const sheet = _responseSheet();
  _ensureColumns(sheet);
  const row = e.range.getRow();
  const cols = _cols(sheet);

  sheet.getRange(row, cols[STATUS_COL]).setValue(AUTO_APPROVE ? 'APPROVED' : 'PENDING');
  SpreadsheetApp.flush();

  const v = _rowValues(sheet, row, cols);
  const summary = [
    'New community event submission:',
    '',
    'Event:    ' + (v[Q.game] ? v[Q.game] + ' ' : '') + v[Q.name],
    'Date:     ' + v[Q.date],
    'Time:     ' + v[Q.start] + (v[Q.end] ? ' - ' + v[Q.end] : ''),
    'Venue:    ' + (v[Q.venue] || '(none)') + (v[Q.address] ? ', ' + v[Q.address] : ''),
    'Link:     ' + (v[Q.link] || '(none)'),
    '',
    AUTO_APPROVE ? 'AUTO_APPROVE is on - it is being published now.'
                 : 'To publish it, set its Status to APPROVED in the sheet:',
    SpreadsheetApp.getActiveSpreadsheet().getUrl(),
  ].join('\n');
  MailApp.sendEmail(NOTIFY_EMAIL, '[Pokemon Calendar] Event submission: ' + v[Q.name], summary);

  if (AUTO_APPROVE) _processRow(sheet, row, cols);
}

/** Owner edited the sheet: react to Status changes. */
function handleEdit(e) {
  const sheet = _responseSheet();
  if (e.range.getSheet().getName() !== sheet.getName()) return;
  const cols = _cols(sheet);
  if (e.range.getColumn() !== cols[STATUS_COL] || e.range.getRow() === 1) return;
  _processRow(sheet, e.range.getRow(), cols);
}

/** Backup sweep (menu item): processes every row's current status. */
function processAllRows() {
  const sheet = _responseSheet();
  _ensureColumns(sheet);
  const cols = _cols(sheet);
  for (let r = 2; r <= sheet.getLastRow(); r++) _processRow(sheet, r, cols);
}

// ======= CORE =======

function _processRow(sheet, row, cols) {
  const v = _rowValues(sheet, row, cols);
  const status = String(v[STATUS_COL] || '').toUpperCase().trim();
  const eventId = String(v[EVENT_ID_COL] || '').trim();

  try {
    if (status === 'APPROVED' && !eventId) {
      const id = _publish(v);
      sheet.getRange(row, cols[EVENT_ID_COL]).setValue(id);
      sheet.getRange(row, cols[STATUS_COL]).setValue('PUBLISHED');
    } else if (status === 'REMOVE' && eventId) {
      const ev = CalendarApp.getCalendarById(COMMUNITY_CALENDAR_ID).getEventById(eventId);
      if (ev) ev.deleteEvent();
      sheet.getRange(row, cols[STATUS_COL]).setValue('REMOVED');
    }
  } catch (err) {
    sheet.getRange(row, cols[STATUS_COL]).setValue('ERROR');
    MailApp.sendEmail(NOTIFY_EMAIL,
      '[Pokemon Calendar] Failed to process row ' + row,
      String(err && err.message ? err.message : err) + '\n\n' +
      SpreadsheetApp.getActiveSpreadsheet().getUrl());
  }
}

/** Creates the calendar event from a row's values; returns the event id. */
function _publish(v) {
  const name = String(v[Q.name] || '').trim();
  if (!name) throw new Error('Missing "' + Q.name + '"');
  if (!(v[Q.date] instanceof Date)) throw new Error('Missing/invalid "' + Q.date + '"');

  const cal = CalendarApp.getCalendarById(COMMUNITY_CALENDAR_ID);
  if (!cal) throw new Error('Calendar not found: ' + COMMUNITY_CALENDAR_ID);

  // Title follows the site convention "GAME Event name @ VENUE"
  // (e.g. "TCG League Night @ SUPER GAMES"). Adjust here if unwanted.
  const game = String(v[Q.game] || '').trim();
  const venue = String(v[Q.venue] || '').trim();
  const title = (game ? game + ' ' : '') + name + (venue ? ' @ ' + venue : '');

  // Location = venue + address, like the synced official events.
  const location = [venue, String(v[Q.address] || '').trim()].filter(Boolean).join(', ');

  // Description: submitter text, then link and image URL on their own lines —
  // the web widget's popup linkifies URLs and renders image URLs inline.
  const description = [v[Q.description], v[Q.link], v[Q.image]]
    .map(s => String(s || '').trim()).filter(Boolean).join('\n\n');
  const options = { location: location, description: description };

  let event;
  const startTime = _toTime(v[Q.start]);
  const endTime = _toTime(v[Q.end]);
  if (startTime) {
    const start = _combine(v[Q.date], startTime);
    let end = endTime
      ? _combine(v[Q.date], endTime)
      : new Date(start.getTime() + DEFAULT_DURATION_HOURS * 3600000);
    if (end <= start) end = new Date(end.getTime() + 86400000);   // crosses midnight
    event = cal.createEvent(title, start, end, options);
  } else {
    event = cal.createAllDayEvent(title, v[Q.date], options);     // no start time given
  }
  return event.getId();
}

/**
 * Coerces a sheet cell to a {hours, minutes} time, or null.
 * Accepts real time cells (Date objects) and text like "6:00 PM" / "18:00".
 */
function _toTime(val) {
  if (val instanceof Date) return { hours: val.getHours(), minutes: val.getMinutes() };
  const m = String(val || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!m) return null;
  let hours = Number(m[1]);
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  return { hours: hours, minutes: Number(m[2]) };
}

/**
 * Paste-and-run diagnostic: logs exactly what the script sees for a row.
 * Set the row number below, run it, then View -> Logs (Ctrl+Enter).
 */
function debugRow() {
  const ROW = 2;                       // <-- change to the row you're testing
  const sheet = _responseSheet();
  const cols = _cols(sheet);
  const v = _rowValues(sheet, ROW, cols);
  Logger.log('Sheet tz: %s | Script tz: %s',
    SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(),
    Session.getScriptTimeZone());
  Object.keys(Q).forEach(function (k) {
    const val = v[Q[k]];
    Logger.log('%s ("%s"): [%s] %s', k, Q[k],
      Object.prototype.toString.call(val), String(val));
  });
  Logger.log('Parsed start: %s | Parsed end: %s',
    JSON.stringify(_toTime(v[Q.start])), JSON.stringify(_toTime(v[Q.end])));
  Logger.log('Headers not matched by Q: %s',
    Object.keys(cols).filter(h => Object.values(Q).indexOf(h) === -1
      && [STATUS_COL, EVENT_ID_COL, 'Timestamp', 'Email Address'].indexOf(h) === -1).join(' | ') || '(none)');
}

// ======= HELPERS =======

/** The linked form-responses sheet (first sheet named "Form Responses ..."). */
function _responseSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheets().find(s => /^Form Responses/i.test(s.getName())) || ss.getSheets()[0];
}

/** Header name -> 1-based column index. */
function _cols(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => { map[String(h).trim()] = i + 1; });
  return map;
}

function _rowValues(sheet, row, cols) {
  const values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  const out = {};
  Object.keys(cols).forEach(h => { out[h] = values[cols[h] - 1]; });
  return out;
}

/** Appends Status/Event ID columns + the Status dropdown if not present. */
function _ensureColumns(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  [STATUS_COL, EVENT_ID_COL].forEach(name => {
    if (!headers.some(h => h.trim() === name)) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(name);
      headers.push(name);
    }
  });
  const statusCol = _cols(sheet)[STATUS_COL];
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_VALUES, true).setAllowInvalid(false).build();
  sheet.getRange(2, statusCol, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
}

/** Date cell + parsed {hours, minutes} -> one Date in the script time zone. */
function _combine(dateVal, time) {
  return new Date(dateVal.getFullYear(), dateVal.getMonth(), dateVal.getDate(),
                  time.hours, time.minutes, 0, 0);
}
