#!/usr/bin/env python3
"""Record the dates events were added to the calendars.

Keeps update-history.csv: one row per date (US Eastern) on which new events
appeared in any of the app's Google Calendars, with how many were added.
The CSV lives on the `update-history` branch (kept off main so the daily
bot commits never get in the way of local work). Run daily by
.github/workflows/update-history.yml with the CSV's path as the argument;
by hand: `python3 .github/scripts/update_history.py path/to/update-history.csv`.

Each run counts events whose `created` time is newer than the newest one
already logged, so re-running never double-counts. The first run backfilled
from the events present at the time; events deleted before then are missing.
Calendar IDs and the API key are read from app.js so there's one source.
"""
import csv
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ET = ZoneInfo('America/New_York')
# The API key is restricted to these referrers; identify as the live site.
REFERER = 'https://pizzacatz.github.io/pokemon-calendar-webapp/'
FIELDS = ['date_et', 'events_added', 'newest_added_utc']


def read_config():
    src = open(os.path.join(ROOT, 'app.js'), encoding='utf-8').read()
    key = re.search(r"GOOGLE_CALENDAR_API_KEY\s*=\s*'([^']+)'", src).group(1)
    ids = re.findall(r"googleCalendarId:\s*'([^']+)'", src)
    return key, ids


def created_times(cal_id, key):
    """Yield every event's creation time (aware UTC datetime) in a calendar."""
    token = None
    while True:
        q = {'maxResults': 2500, 'fields': 'items(created),nextPageToken', 'key': key}
        if token:
            q['pageToken'] = token
        url = ('https://www.googleapis.com/calendar/v3/calendars/'
               + urllib.parse.quote(cal_id) + '/events?' + urllib.parse.urlencode(q))
        req = urllib.request.Request(url, headers={'Referer': REFERER})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
        for ev in data.get('items', []):
            if ev.get('created'):
                yield datetime.fromisoformat(ev['created'].replace('Z', '+00:00'))
        token = data.get('nextPageToken')
        if not token:
            return


def main():
    log = sys.argv[1] if len(sys.argv) > 1 else 'update-history.csv'
    rows = []
    if os.path.exists(log):
        with open(log, newline='', encoding='utf-8') as f:
            rows = list(csv.DictReader(f))
    by_date = {r['date_et']: r for r in rows}
    watermark = max((datetime.fromisoformat(r['newest_added_utc']) for r in rows), default=None)

    key, ids = read_config()
    added = defaultdict(int)
    newest = {}
    for cal_id in ids:
        for t in created_times(cal_id, key):
            if watermark and t <= watermark:
                continue
            d = t.astimezone(ET).date().isoformat()
            added[d] += 1
            newest[d] = max(newest.get(d, t), t)

    for d, n in added.items():
        r = by_date.setdefault(d, {'date_et': d, 'events_added': 0, 'newest_added_utc': ''})
        r['events_added'] = int(r['events_added']) + n
        r['newest_added_utc'] = max(filter(None, [r['newest_added_utc'], newest[d].isoformat()]))

    with open(log, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for d in sorted(by_date):
            w.writerow(by_date[d])
    print(f'{sum(added.values())} new event(s) on {len(added)} date(s)')


if __name__ == '__main__':
    main()
