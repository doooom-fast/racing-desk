#!/usr/bin/env python3
"""Find and download the official PSD paint template for an iRacing car.

    get_template.py "Lotus 79"                 # download + unzip, report the PSD
    get_template.py lotus79 --out ~/templates  # folder name works too
    get_template.py --search porsche           # list matches
    get_template.py --list                     # every car

Templates are iRacing's own PSDs, indexed publicly by Trading Paints (no login). cars.tsv holds
the mapping; refresh it with refresh_cars.py when iRacing adds cars.
"""
import argparse, csv, re, sys, urllib.request, zipfile
from pathlib import Path
TSV = Path(__file__).parent/'cars.tsv'

def load():
    with open(TSV) as fh: return list(csv.DictReader(fh, delimiter='\t'))

def norm(s): return re.sub(r'[^a-z0-9]', '', s.lower())

def find(cars, q):
    n = norm(q)
    exact = [c for c in cars if norm(c['paint_folder']) == n or norm(c['car_name']) == n]
    return exact or [c for c in cars if n in norm(c['car_name']) or n in norm(c['paint_folder'])]

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('car', nargs='?'); ap.add_argument('--out', default='.')
    ap.add_argument('--search'); ap.add_argument('--list', action='store_true')
    ap.add_argument('--no-download', action='store_true', help='just print the match and its URL')
    a = ap.parse_args(); cars = load()
    if a.list or a.search:
        for c in (cars if a.list else find(cars, a.search)):
            print('%-38s folder %-26s %s' % (c['car_name'], c['paint_folder'], c['template_zip']))
        return 0
    if not a.car: ap.error('name a car, or use --search / --list')
    hits = find(cars, a.car)
    if not hits:
        print('No match for %r. Try --search.' % a.car); return 2
    if len(hits) > 1:
        print('Several matches, be more specific:')
        for c in hits: print('   %-38s folder %s' % (c['car_name'], c['paint_folder']))
        return 2
    c = hits[0]
    print('%s\n  paint folder : %s      <- the sim reads files from here\n  template     : %s'
          % (c['car_name'], c['paint_folder'], c['template_zip']))
    if a.no_download: return 0
    out = Path(a.out).expanduser()/c['paint_folder']; out.mkdir(parents=True, exist_ok=True)
    zpath = out/Path(c['template_zip']).name
    if not zpath.exists():
        print('  downloading  ...', end=' ', flush=True)
        req = urllib.request.Request(c['template_zip'], headers={'User-Agent': 'livery-tool/1.0'})
        with urllib.request.urlopen(req, timeout=300) as r, open(zpath, 'wb') as fh:
            fh.write(r.read())
        print('%.1f MB' % (zpath.stat().st_size/1e6))
    with zipfile.ZipFile(zpath) as z:
        names = z.namelist(); z.extractall(out)
    psds = sorted(out.rglob('*.psd'))
    for n in names: print('  contains     : %s' % n)
    for p in psds: print('  PSD          : %s' % p)
    if not psds: print('  NOTE: no .psd inside; open the archive to see what iRacing shipped.')
    return 0

if __name__ == '__main__': sys.exit(main())
