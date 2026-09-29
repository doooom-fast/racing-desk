#!/usr/bin/env python3
"""Install finished livery files into an iRacing paint folder under the names the sim expects.

iRacing looks for  <paint root>/<car folder>/car_<custID>.tga  and friends. Everything is renamed
from whatever the design folder calls it, so no manual filename editing.

    install_paint.py --src v10_remix --car lotus79 --id 123456            # install
    install_paint.py --src v10_remix --car lotus79 --id auto              # infer the ID
    install_paint.py --src v10_remix --car lotus79 --id 123456 --stage out/   # PC not mounted
    install_paint.py --find-id                                            # just report the ID

Names it writes (only for files present in --src):
    car_<id>.tga        paint          car_spec_<id>.tga   spec map
    car_num_<id>.tga    number layer   car_decal_<id>.tga  decals
    helmet_<id>.tga     helmet         suit_<id>.tga       suit
"""
import argparse, os, re, shutil, struct, sys
from collections import Counter
from pathlib import Path

ROLES = {                       # source basename contains -> iRacing prefix
    'car_spec': 'car_spec', 'spec': 'car_spec',
    'car_num': 'car_num', 'number': 'car_num',
    'car_decal': 'car_decal', 'decal': 'car_decal',
    'helmet': 'helmet', 'suit': 'suit',
}
DEFAULT_ROOTS = [
    Path.home()/'Documents'/'iRacing'/'paint',                     # mac/linux layout
    Path.home()/'OneDrive'/'Documents'/'iRacing'/'paint',
]

def tga_info(path):
    """(width, height, bits, rle) from the 18-byte TGA header; iRacing wants 24-bit 1024/2048."""
    with open(path, 'rb') as fh: h = fh.read(18)
    if len(h) < 18: return None
    image_type = h[2]
    w, hgt, bits = struct.unpack('<HHB', h[12:17])
    return w, hgt, bits, image_type in (9, 10, 11)

def role_for(name):
    low = name.lower()
    for key in sorted(ROLES, key=len, reverse=True):
        if key in low: return ROLES[key]
    return 'car' if low.endswith('.tga') else None

CARS_TSV = [Path(__file__).parent/'cars.tsv',
            Path(__file__).parents[2]/'iracing-paint-templates'/'scripts'/'cars.tsv']

def resolve_car(name):
    """Accept a car name or its folder name; return the folder the sim actually reads."""
    import csv, re
    for tsv in CARS_TSV:
        if not tsv.exists(): continue
        rows = list(csv.DictReader(open(tsv), delimiter='\t'))
        n = re.sub(r'[^a-z0-9]', '', name.lower())
        exact = [r for r in rows if re.sub(r'[^a-z0-9]', '', r['paint_folder'].lower()) == n
                 or re.sub(r'[^a-z0-9]', '', r['car_name'].lower()) == n]
        hits = exact or [r for r in rows if n in re.sub(r'[^a-z0-9]', '', r['car_name'].lower())]
        if len(hits) == 1: return hits[0]['paint_folder'], hits[0]['car_name']
        if len(hits) > 1:
            print('Ambiguous car %r: %s' % (name, ', '.join(h['paint_folder'] for h in hits[:6])))
            sys.exit(2)
    return name, name      # no table: assume the folder name was given

def find_paint_roots(extra=None):
    roots = [Path(extra)] if extra else []
    roots += [r for r in DEFAULT_ROOTS if r.is_dir()]
    for vol in Path('/Volumes').glob('*'):          # a mounted Windows PC or share
        p = vol/'Users'
        if not p.is_dir(): continue
        for user in list(p.glob('*'))[:20]:
            cand = user/'Documents'/'iRacing'/'paint'
            if cand.is_dir(): roots.append(cand)
    return [r for r in dict.fromkeys(roots) if r.is_dir()]

def find_id(roots):
    """Customer ID inferred from files already in the paint folders. The sim writes and reads
    car_<id>.tga, so the number that shows up most often across cars is the account's ID."""
    ids = Counter()
    for root in roots:
        for f in root.rglob('*_*.tga'):
            m = re.search(r'_(\d{4,8})\.tga$', f.name)
            if m: ids[m.group(1)] += 1
        for f in root.rglob('*_*.mip'):
            m = re.search(r'_(\d{4,8})\.mip$', f.name)
            if m: ids[m.group(1)] += 1
    return ids

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', help='folder holding the finished .tga files')
    ap.add_argument('--car', help="car folder name as the sim spells it, e.g. lotus79")
    ap.add_argument('--id', help='iRacing customer ID, or "auto" to infer it')
    ap.add_argument('--paint-root', help='paint folder root (default: search the usual places)')
    ap.add_argument('--stage', help='write into this folder instead of the paint root')
    ap.add_argument('--pad6', action='store_true', help='pad the ID to 6 digits (sorts better)')
    ap.add_argument('--find-id', action='store_true', help='report the customer ID and exit')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    roots = find_paint_roots(a.paint_root)
    if a.find_id or a.id == 'auto':
        counts = find_id(roots)
        if not counts:
            print('No existing paint files found, so the ID cannot be inferred.')
            print('Get it from the iRacing UI: helmet icon (top right) -> Profile.')
            print('Searched:', ', '.join(str(r) for r in roots) or 'nothing (no paint folder found)')
            if a.find_id: return 0
            sys.exit(2)
        best, n = counts.most_common(1)[0]
        print('Customer ID %s (seen in %d existing paint files)' % (best, n))
        if len(counts) > 1: print('  others seen:', dict(counts.most_common()[1:5]))
        if a.find_id: return 0
        a.id = best

    for req in ('src', 'car', 'id'):
        if not getattr(a, req): ap.error('--%s is required' % req)
    folder, car_name = resolve_car(a.car)
    a.car = folder
    cid = a.id.zfill(6) if a.pad6 else a.id
    src = Path(a.src)
    if not src.is_dir(): ap.error('--src %s is not a folder' % src)

    if a.stage:
        dest = Path(a.stage)/a.car
    else:
        if not roots: ap.error('no iRacing paint folder found; pass --paint-root or --stage')
        dest = roots[0]/a.car
    print('car         %s  (paint folder: %s)' % (car_name, folder))
    print('source      %s\ndestination %s\ncustomer ID %s' % (src, dest, cid))

    plan = []
    for f in sorted(src.glob('*.tga')):
        role = role_for(f.name)
        if not role: continue
        plan.append((f, dest/('%s_%s.tga' % (role, cid))))
    if not plan: ap.error('no .tga files in %s' % src)

    for f, target in plan:
        w, h, bits, rle = tga_info(f) or (0, 0, 0, False)
        warn = []
        if bits != 24: warn.append('%d-bit (iRacing expects 24-bit; 32-bit only for paintable windows)' % bits)
        if w != h or w not in (1024, 2048): warn.append('%dx%d (expected 1024 or 2048 square)' % (w, h))
        print('  %-34s -> %-24s %s' % (f.name, target.name, ('WARNING: ' + '; '.join(warn)) if warn else 'ok'))
    if a.dry_run: print('dry run, nothing written'); return 0

    dest.mkdir(parents=True, exist_ok=True)
    for f, target in plan:
        if target.exists(): shutil.copy2(target, target.with_suffix('.tga.bak'))
        shutil.copy2(f, target)
    print('wrote %d file(s)' % len(plan))
    if any(t.name.startswith('car_spec') for _, t in plan):
        print('\nSpec map note: drive the car once and iRacing writes car_spec_%s.mip beside it.' % cid)
        print('That .mip is what Trading Paints needs. Remove the spec .tga afterwards or the sim')
        print('keeps regenerating it.')
    return 0

if __name__ == '__main__':
    sys.exit(main())
