#!/usr/bin/env node
/**
 * Builds data/majors.json — Regional, Special, International and World
 * Championships, as a FullCalendar JSON event feed.
 *
 * The five pokedata feeds this calendar already syncs cover locals only: Cups,
 * Challenges and Prereleases. Nothing covered the majors, which is why they were
 * missing rather than stale.
 *
 * Source: https://championships.pokemon.com/api/events.json — the official feed
 * behind the events page. It is plain JSON, needs no key and no headless browser,
 * and carries every published major for the season across eight locales.
 *
 * Approach borrowed from pokemon-majors-map: scrape on a schedule, commit the
 * result, and let the static site read a versioned file rather than scrape at
 * runtime.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/majors.json');
const FEED = 'https://championships.pokemon.com/api/events.json';
const UA = 'pokemon-calendar/1.0 (+https://github.com/pizzacatz/pokemon-calendar-webapp)';

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * A Championship Series season runs September to August, and the feed labels an
 * event with the season it belongs to rather than the calendar year it falls in.
 * So "Sept. 18-20" in the 2027 season is September 2026.
 */
const calendarYear = (month, seasonYear) => (month >= 9 ? seasonYear - 1 : seasonYear);

const iso = (y, m, d) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Parse the feed's display range into ISO dates.
 * Handles "Sept. 18-20", "Oct. 31 - Nov. 1", "June 5-6" and single days.
 * Both en and en-dash appear; so does a missing trailing period on the month.
 */
export function parseRange(text, seasonYear) {
  if (!text) return null;
  const t = text.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

  const month = (name) => MONTHS[name.toLowerCase().replace(/\./g, '').slice(0, 4)]
    ?? MONTHS[name.toLowerCase().replace(/\./g, '').slice(0, 3)];

  // "Oct. 31 - Nov. 1"
  let m = /^([A-Za-z.]+)\s*(\d{1,2})\s*-\s*([A-Za-z.]+)\s*(\d{1,2})$/.exec(t);
  if (m) {
    const m1 = month(m[1]), m2 = month(m[3]);
    if (!m1 || !m2) return null;
    return {
      start: iso(calendarYear(m1, seasonYear), m1, Number(m[2])),
      end: iso(calendarYear(m2, seasonYear), m2, Number(m[4])),
    };
  }

  // "Sept. 18-20"
  m = /^([A-Za-z.]+)\s*(\d{1,2})\s*-\s*(\d{1,2})$/.exec(t);
  if (m) {
    const mm = month(m[1]);
    if (!mm) return null;
    const y = calendarYear(mm, seasonYear);
    return { start: iso(y, mm, Number(m[2])), end: iso(y, mm, Number(m[3])) };
  }

  // "June 5"
  m = /^([A-Za-z.]+)\s*(\d{1,2})$/.exec(t);
  if (m) {
    const mm = month(m[1]);
    if (!mm) return null;
    const y = calendarYear(mm, seasonYear);
    return { start: iso(y, mm, Number(m[2])), end: iso(y, mm, Number(m[2])) };
  }
  return null;
}

/**
 * The feed types every non-International major as "regional", so a Special
 * Championship is only identifiable from its name. Same rule the majors map uses.
 */
export function classify(name, type) {
  const n = (name || '').toLowerCase();
  if (type === 'world' || n.includes('world championships')) return 'worlds';
  if (n.includes('international')) return 'international';
  if (n.includes('special')) return 'special';
  return 'regional';
}

const REGIONS = {
  northamerica: 'North America',
  europe: 'Europe',
  latinamerica: 'Latin America',
  oceania: 'Oceania',
  middleeast: 'Middle East & South Africa',
};

/** FullCalendar treats an all-day end date as exclusive, so add a day. */
function exclusiveEnd(endIso) {
  const d = new Date(`${endIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const res = await fetch(FEED, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${FEED}`);
  const { items = [] } = await res.json();

  const seen = new Set();
  const events = [];
  const skipped = [];

  for (const item of items) {
    if (item.locale_s !== 'en-us') continue;              // one locale; the rest are translations
    const seasonYear = Number(item.year_s);
    if (!Number.isFinite(seasonYear)) continue;

    const name = (item.eventName_s || '').trim();
    const range = parseRange(item.displayDateRange_s, seasonYear);
    if (!range) { skipped.push(`${name} — unparsed date "${item.displayDateRange_s}"`); continue; }

    const key = `${range.start}|${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const category = classify(name, item.type_s);
    events.push({
      id: `major-${range.start}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      title: name.replace(/^\d{4}\s+/, '').replace(/\s+Pokémon\s+/, ' '),
      start: range.start,
      end: exclusiveEnd(range.end),
      allDay: true,
      url: item.uRL_s || null,
      extendedProps: {
        category,
        season: seasonYear,
        region: REGIONS[item.region_s] || item.region_s || null,
        location: item.eventLocation_s || null,
        officialUrl: item.uRL_s || null,
      },
    });
  }

  events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: FEED,
      note: 'Regionals, Specials, Internationals and Worlds. The pokedata feeds this '
          + 'calendar syncs cover locals only, so majors come from the official feed.',
      count: events.length,
    },
    events,
  };

  // A refresh that returns nothing is a broken refresh, not an empty season.
  if (!events.length) {
    if (existsSync(OUT)) {
      console.error('feed returned no majors; keeping the previous file');
      process.exit(1);
    }
    throw new Error('feed returned no majors and there is nothing to fall back to');
  }

  mkdirSync(dirname(OUT), { recursive: true });
  // Keep the timestamp out of the diff when nothing else changed, so the daily
  // job does not churn a commit every morning.
  if (existsSync(OUT)) {
    const prev = JSON.parse(readFileSync(OUT, 'utf8'));
    if (JSON.stringify(prev.events) === JSON.stringify(events)) {
      console.log(`no change (${events.length} majors)`);
      return;
    }
  }
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');

  const byCat = events.reduce((a, e) => ({ ...a, [e.extendedProps.category]: (a[e.extendedProps.category] ?? 0) + 1 }), {});
  console.log(`wrote ${events.length} majors`, byCat);
  if (skipped.length) console.warn(`skipped ${skipped.length}:`, skipped.slice(0, 5));
}

// pathToFileURL, not string concatenation: this repo's path contains spaces,
// which percent-encode in a file:// URL and would never match argv[1].
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
