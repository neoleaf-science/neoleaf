#!/usr/bin/env python3
"""Snapshot of this site's result on websitecarbon.com, for the footer of the landing page.

Reads the public result page and writes site/carbon.json (grams of CO2 per view, "cleaner than N% of pages", rating,
test date, green energy). The landing page shows these numbers itself: visitors never contact websitecarbon.com or a CDN
for it. Run it (mise run carbon) when you want fresh numbers, then deploy the site (mise run deploy:site).
It writes nothing if the page cannot be read or has changed shape.
"""
import json, os, re, sys, urllib.request, datetime

SOURCE = 'https://www.websitecarbon.com/website/neoleaf-science/'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'site', 'carbon.json')
MONTHS = {m: i + 1 for i, m in enumerate('Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split())}


def fail(msg):
    print('fetch_carbon: ' + msg, file=sys.stderr)
    sys.exit(1)


def main():
    req = urllib.request.Request(SOURCE, headers={'User-Agent': 'Mozilla/5.0 (compatible; NeoLeaf-site-check)'})
    try:
        html = urllib.request.urlopen(req, timeout=40).read().decode('utf-8', 'replace')
    except Exception as e:
        fail(f'could not read {SOURCE}: {e}')
    text = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', re.sub(r'<(script|style).*?</\1>', '', html, flags=re.S)))
    grams = re.search(r'"grams":\s*([0-9.]+)', html)
    energy = re.search(r'"energy":\s*([0-9.]+)', html)
    co2 = re.search(r'id="js-emission-count"[^>]*data-count="([0-9.]+)"|data-count="([0-9.]+)"[^>]*id="js-emission-count"', html)
    cleaner = re.search(r'cleaner than.*?data-count="(\d+)"', html, flags=re.S | re.I)
    rating = re.search(r'carbon rating of\s+([A-F]\+?)', text)
    tested = re.search(r'last tested on (\d{1,2}) (\w{3}), (\d{4})', text)
    green = re.search(r'appears to be running on (\w+) energy', text)
    if not all([grams, energy, co2, cleaner, rating, tested, green]) or tested.group(2) not in MONTHS:
        fail('the result page has a shape this script does not know: nothing written')
    data = {
        'source': SOURCE,
        'grams': round(float(grams.group(1)), 4),
        'co2': float(co2.group(1) or co2.group(2)),
        'energy_kwh': round(float(energy.group(1)), 6),
        'cleaner_than': int(cleaner.group(1)),
        'rating': rating.group(1),
        'tested': datetime.date(int(tested.group(3)), MONTHS[tested.group(2)], int(tested.group(1))).isoformat(),
        'green': green.group(1).lower() == 'sustainable',
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=1)
        f.write('\n')
    print('site/carbon.json:', json.dumps(data))


main()
