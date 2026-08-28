/**
 * Date parsing is the only part of the majors scraper that can be wrong quietly:
 * a season label of 2027 means September 2026 for autumn events and 2027 for
 * spring ones. Everything else fails loudly. Run with `node scraper/majors.test.mjs`.
 */
import assert from 'node:assert/strict';
import { parseRange, classify } from './majors.mjs';

const cases = [
  // [display range, season, expected start, expected end]
  ['Sept. 18–20',      2027, '2026-09-18', '2026-09-20'],  // autumn -> previous year
  ['Dec. 4–6',         2027, '2026-12-04', '2026-12-06'],
  ['Jan. 15–17',       2027, '2027-01-15', '2027-01-17'],  // spring -> season year
  ['June 18–20',       2027, '2027-06-18', '2027-06-20'],
  ['Oct. 31 – Nov. 1', 2027, '2026-10-31', '2026-11-01'],  // crosses a month
  ['Aug. 28–30',       2026, '2026-08-28', '2026-08-30'],  // Worlds closes its season
  ['May 8–9',          2027, '2027-05-08', '2027-05-09'],
  ['Mar. 6–7',         2027, '2027-03-06', '2027-03-07'],
];

for (const [text, season, start, end] of cases) {
  const got = parseRange(text, season);
  assert.deepEqual(got, { start, end }, `${text} (${season}) -> ${JSON.stringify(got)}`);
}

assert.equal(parseRange('nonsense', 2027), null);
assert.equal(parseRange('', 2027), null);

// The feed types every non-International major as "regional", so a Special is
// only identifiable from its name.
assert.equal(classify('2027 Auckland Pokémon Special Championships', 'regional'), 'special');
assert.equal(classify('2027 Pokémon Europe International Championships', 'international'), 'international');
assert.equal(classify('2027 Baltimore Pokémon Regional Championships', 'regional'), 'regional');
assert.equal(classify('2026 Pokémon World Championships', 'world'), 'worlds');

console.log(`majors parser: ${cases.length + 6} checks passed`);
