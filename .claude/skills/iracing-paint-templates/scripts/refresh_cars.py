#!/usr/bin/env python3
"""Rebuild cars.tsv: every iRacing car -> its paint folder name and its PSD template zip.

Source is the public Trading Paints template index (no login), which lists both the folder the
sim reads (Documents/iRacing/paint/<folder>) and iRacing's own template download.

    refresh_cars.py [--out cars.tsv]
"""
import argparse, html, re, urllib.request
from pathlib import Path
URL = 'https://www.tradingpaints.com/cartemplates'
BLOCK = re.compile(r'<div id="car"(.*?)</div>', re.S)   # one card per car, parsed on its own
ZIP = re.compile(r'href="(https://[^"]*car_templates/(\d+)_template_([^."]+)\.zip)"')
NAME = re.compile(r'<h3[^>]*>\s*<span>([^<]+)</span>')
FOLDER = re.compile(r'paint/<span>([^<]+)</span>')

def scrape(url=URL):
    req = urllib.request.Request(url, headers={'User-Agent': 'livery-tool/1.0'})
    page = urllib.request.urlopen(req, timeout=60).read().decode('utf-8', 'ignore')
    rows, seen = [], set()
    for block in BLOCK.findall(page):
        z, n, f = ZIP.search(block), NAME.search(block), FOLDER.search(block)
        if not (z and n and f): continue
        folder = f.group(1).strip()
        if folder in seen: continue
        seen.add(folder)
        rows.append((html.unescape(n.group(1)).strip(), folder, z.group(3), z.group(2), z.group(1)))
    return rows

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default=str(Path(__file__).parent/'cars.tsv'))
    a = ap.parse_args(); rows = scrape()
    with open(a.out, 'w') as fh:
        fh.write('car_name\tpaint_folder\ttemplate_code\ttemplate_id\ttemplate_zip\n')
        for r in rows: fh.write('\t'.join(r) + '\n')
    print('wrote %d cars -> %s' % (len(rows), a.out))
