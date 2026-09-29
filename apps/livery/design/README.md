# The library's design scripts

The scripts that composed the liveries in the library, one folder per car, as they were written.
They came from the livery library's `design/` folder on 2026-09-28 (its commit `77ae479`).

They are kept to be read, not run: they were written on another machine and name its disks
(`/Volumes/Claude/doooom/...`). What has been made to run here is in `src/livery/fleet`:

| Here | Runs as |
|---|---|
| `fleet/build_fleet.py` | `livery.fleet.build` - `livery fleet build` |
| `fleet/shatter_livery.py`, `shatter_livery.py` | `livery.fleet.shatter` |
| `fleet/fleet_logos.py` | `livery.fleet.logos` - `livery fleet panels`, `livery fleet logos` |
| `fleet/panels/*.json` | `src/livery/data/panels/` |
| `fleet/extract_patterns.sh` | `livery fleet panels` reads a car's stock schemes itself |

The per-car scripts (`lotus79`, `mx5`, `nissangtpzxt`, `mclaren720sgt3`, `porsche963gtp`) and
`configs/` are here as written and have not been made to run: each is one car's own design, and
its paint is in the library.
