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

// Form question titles -> must match the form EXACTLY (copy/paste them).
const Q = {
  name:        'Event name',
  date:        'Event date',
  start:       'Start time',
  end:         'End time',
  location:    'Location (venue name and address)',
  description: 'Description',
  link:        'Event link (optional)',
  image:       'Image URL (optional)',
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

  ScriptApp.getProjectTriggers()
    .filter(t => ['handleFormSubmit', 'handleEdit'].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
    'Event:    ' + v[Q.name],
    'Date:     ' + v[Q.date],
    'Time:     ' + v[Q.start] + (v[Q.end] ? ' - ' + v[Q.end] : ''),
    'Location: ' + (v[Q.location] || '(none)'),
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
  const title = String(v[Q.name] || '').trim();
  if (!title) throw new Error('Missing "' + Q.name + '"');
  if (!(v[Q.date] instanceof Date)) throw new Error('Missing/invalid "' + Q.date + '"');

  const cal = CalendarApp.getCalendarById(COMMUNITY_CALENDAR_ID);
  if (!cal) throw new Error('Calendar not found: ' + COMMUNITY_CALENDAR_ID);

  // Description: submitter text, then link and image URL on their own lines —
  // the web widget's popup linkifies URLs and renders image URLs inline.
  const description = [v[Q.description], v[Q.link], v[Q.image]]
    .map(s => String(s || '').trim()).filter(Boolean).join('\n\n');
  const options = { location: String(v[Q.location] || '').trim(), description: description };

  let event;
  if (v[Q.start] instanceof Date) {
    const start = _combine(v[Q.date], v[Q.start]);
    let end = (v[Q.end] instanceof Date)
      ? _combine(v[Q.date], v[Q.end])
      : new Date(start.getTime() + DEFAULT_DURATION_HOURS * 3600000);
    if (end <= start) end = new Date(end.getTime() + 86400000);   // crosses midnight
    event = cal.createEvent(title, start, end, options);
  } else {
    event = cal.createAllDayEvent(title, v[Q.date], options);     // no start time given
  }
  return event.getId();
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

/** Date question + time question -> one Date in the script time zone. */
function _combine(dateVal, timeVal) {
  return new Date(dateVal.getFullYear(), dateVal.getMonth(), dateVal.getDate(),
                  timeVal.getHours(), timeVal.getMinutes(), 0, 0);
}
