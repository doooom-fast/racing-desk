"""The `livery` command.

Everything the pipeline does is reachable from here, and everything prints what
it did in a form an agent can read back: warnings are lines starting with "!",
so a build that needs attention says so in the first thing you see.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import bake as bakemod
from . import doctor as doctormod
from . import preview as previewmod
from . import templates as templatemod
from .art import ArtLibrary
from .config import Config
from .errors import LiveryError
from .install import install, stage
from .materials import default_library
from .profile import CarProfile, find_profile
from .registry import CarRegistry
from .remix import extract_palette
from .render import Renderer
from .spec import LiverySpec


def main(argv: list[str] | None = None) -> int:
    # Windows gives a piped stdout the ANSI code page, which has no ✓ or ✗; the output is UTF-8 everywhere.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 1
    try:
        return args.func(args)
    except LiveryError as exc:
        print(f"✗ {exc}", file=sys.stderr)
        return 1
    except FileNotFoundError as exc:
        print(f"✗ {exc}", file=sys.stderr)
        return 1


# --------------------------------------------------------------------- parser


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="livery", description="Agentic iRacing livery design and build pipeline"
    )
    parser.add_argument("--root", default=None, help="project root (default: search upward)")
    sub = parser.add_subparsers(dest="command")

    build = sub.add_parser("build", help="render a livery spec to TGA files")
    build.add_argument("spec")
    build.add_argument("--customer-id", default=None)
    build.add_argument("--out", default=None, help="output directory (default: build/<car>/<livery>)")
    build.add_argument("--resolution", type=int, default=None)
    build.add_argument("--install", action="store_true", help="copy into the sim's paint folder")
    build.add_argument("--preview", action="store_true", help="also write a contact sheet")
    build.add_argument("--strict", action="store_true", help="exit non-zero if anything warns")
    build.add_argument("--json", action="store_true", help="print the build report as JSON")
    build.set_defaults(func=cmd_build)

    inst = sub.add_parser("install", help="install an already-built livery into iRacing")
    inst.add_argument("spec")
    inst.add_argument("--customer-id", default=None)
    inst.add_argument("--dry-run", action="store_true")
    inst.add_argument("--no-backup", action="store_true")
    inst.set_defaults(func=cmd_install)

    prev = sub.add_parser("preview", help="build and write a flat contact sheet")
    prev.add_argument("spec")
    prev.add_argument("--out", default=None)
    prev.add_argument("--cell", type=int, default=900)
    prev.set_defaults(func=cmd_preview)

    new = sub.add_parser("new", help="scaffold a livery spec for a car")
    new.add_argument("car")
    new.add_argument("name")
    new.add_argument("--number", default="10")
    new.add_argument("--out", default=None)
    new.set_defaults(func=cmd_new)

    doc = sub.add_parser("doctor", help="check this machine's setup")
    doc.add_argument("car", nargs="?", default=None)
    doc.set_defaults(func=cmd_doctor)

    sw = sub.add_parser("swatches", help="build a material calibration paint for a car")
    sw.add_argument("car")
    sw.add_argument("--out", default=None)
    sw.set_defaults(func=cmd_swatches)

    cars = sub.add_parser("cars", help="the car registry")
    cars_sub = cars.add_subparsers(dest="cars_command")
    c_list = cars_sub.add_parser("list"); c_list.add_argument("filter", nargs="?", default=None)
    c_list.set_defaults(func=cmd_cars_list)
    c_scan = cars_sub.add_parser("scan", help="learn the cars from the iRacing install and paint folder")
    c_scan.set_defaults(func=cmd_cars_scan)
    c_cov = cars_sub.add_parser("coverage", help="which cars have profiles")
    c_cov.add_argument("--json", action="store_true")
    c_cov.set_defaults(func=cmd_cars_coverage)

    prof = sub.add_parser("profile", help="car profiles (the flat model)")
    prof_sub = prof.add_subparsers(dest="profile_command")
    p_list = prof_sub.add_parser("list"); p_list.set_defaults(func=cmd_profile_list)
    p_show = prof_sub.add_parser("show"); p_show.add_argument("car")
    p_show.set_defaults(func=cmd_profile_show)
    p_boot = prof_sub.add_parser("bootstrap", help="draft a profile from a template PSD")
    p_boot.add_argument("car")
    p_boot.add_argument("--psd", default=None)
    p_boot.add_argument("--blank", action="store_true")
    p_boot.add_argument("--width", type=int, default=2048)
    p_boot.add_argument("--height", type=int, default=2048)
    p_boot.add_argument("--force", action="store_true")
    p_boot.set_defaults(func=cmd_profile_bootstrap)
    p_layers = prof_sub.add_parser("layers", help="list a template PSD's layers and how they classify")
    p_layers.add_argument("car")
    p_layers.add_argument("--psd", default=None)
    p_layers.set_defaults(func=cmd_profile_layers)
    p_bake = prof_sub.add_parser("from-bake", help="derive a profile from 3D bake maps")
    p_bake.add_argument("car")
    p_bake.add_argument("--bake", default=None)
    p_bake.add_argument("--force", action="store_true")
    p_bake.set_defaults(func=cmd_profile_from_bake)

    art = sub.add_parser("art", help="the sponsor art library")
    art_sub = art.add_subparsers(dest="art_command")
    a_list = art_sub.add_parser("list"); a_list.add_argument("--tier", default=None)
    a_list.set_defaults(func=cmd_art_list)
    a_imp = art_sub.add_parser("import"); a_imp.add_argument("file"); a_imp.add_argument("id")
    a_imp.add_argument("--tier", default="secondary")
    a_imp.add_argument("--min-height-mm", type=float, default=60.0)
    a_imp.add_argument("--keep-background", action="store_true")
    a_imp.set_defaults(func=cmd_art_import)
    a_pal = art_sub.add_parser("palette", help="pull a palette out of reference art")
    a_pal.add_argument("image"); a_pal.add_argument("--count", type=int, default=5)
    a_pal.set_defaults(func=cmd_art_palette)

    bk = sub.add_parser("bake", help="bake UV maps from a 3D model (needs Blender)")
    bk.add_argument("car")
    bk.add_argument("--mesh", default=None)
    bk.add_argument("--resolution", type=int, default=2048)
    bk.add_argument("--uv-map", default=None)
    bk.add_argument("--forward", default="+y")
    bk.add_argument("--up", default="+z")
    bk.add_argument("--check", action="store_true", help="verify an existing bake instead")
    bk.add_argument("--template", default=None, help="flattened template PNG to compare UVs against")
    bk.set_defaults(func=cmd_bake)

    mats = sub.add_parser("materials", help="list material presets")
    mats.set_defaults(func=cmd_materials)
    return parser


# ------------------------------------------------------------------- commands


def _config(args) -> Config:
    return Config.load(args.root or Path.cwd())


def _load(args, config: Config) -> tuple[LiverySpec, CarProfile]:
    spec = LiverySpec.load(args.spec)
    profile_path = find_profile(spec.car, [config.profiles_dir, Path.cwd() / "profiles"])
    return spec, CarProfile.load(profile_path)


def _render(args, config: Config):
    spec, profile = _load(args, config)
    if getattr(args, "resolution", None):
        spec.resolution = args.resolution
    renderer = Renderer(spec, profile, ArtLibrary(config.art_root), base_dir=config.root)
    return spec, profile, renderer.render()


def _print_report(report, verbose: bool = True) -> None:
    for note in report.notes if verbose else []:
        print(f"  · {note}")
    for warning in report.warnings:
        print(f"  ! {warning}")
    for step in report.manual_steps:
        print(f"  → {step}")


def cmd_build(args) -> int:
    config = _config(args)
    spec, profile, result = _render(args, config)
    ident = config.require_customer_id(args.customer_id)
    artifacts = stage(result, spec, config, ident, Path(args.out) if args.out else None)

    if args.json:
        print(json.dumps(result.report.to_dict(), indent=2))
    else:
        print(f"built {spec.name} for {spec.car} ({result.canvas.width}×{result.canvas.height})")
        print(f"  albedo   {artifacts.albedo}")
        print(f"  spec map {artifacts.spec_map}")
        print(f"  report   {artifacts.report}")
        _print_report(result.report)

    if args.preview:
        sheet = previewmod.contact_sheet(
            result.canvas, profile, artifacts.albedo.parent / "preview.png"
        )
        print(f"  preview  {sheet}")
    if args.install:
        actions = install(artifacts, config, spec.car)
        for path in actions["copied"]:
            print(f"  installed {path}")
        for path in actions["mips_removed"]:
            print(f"  cleared cached {path}")
    if args.strict and result.report.warnings:
        return 2
    return 0


def cmd_install(args) -> int:
    config = _config(args)
    spec, profile, result = _render(args, config)
    ident = config.require_customer_id(args.customer_id)
    artifacts = stage(result, spec, config, ident)
    actions = install(
        artifacts, config, spec.car, backup=not args.no_backup, dry_run=args.dry_run
    )
    label = "would copy" if args.dry_run else "installed"
    for path in actions["copied"] or actions["skipped"]:
        print(f"{label} {path}")
    for path in actions["mips_removed"]:
        print(f"cleared cached {path}")
    _print_report(result.report, verbose=False)
    return 0


def cmd_preview(args) -> int:
    config = _config(args)
    spec, profile, result = _render(args, config)
    out = Path(args.out) if args.out else config.build_dir / spec.car / spec.slug / "preview.png"
    sheet = previewmod.contact_sheet(result.canvas, profile, out, cell=args.cell)
    print(f"wrote {sheet}")
    _print_report(result.report, verbose=False)
    return 0


def cmd_new(args) -> int:
    config = _config(args)
    profile = CarProfile.load(find_profile(args.car, [config.profiles_dir]))
    numbers = [z for z in profile.number_zones] or [
        n for n in ("door.left", "door.right") if n in profile.zones
    ]
    slug = "".join(c.lower() if c.isalnum() else "-" for c in args.name).strip("-")
    out = Path(args.out) if args.out else config.liveries_dir / f"{slug}.yaml"
    if out.exists():
        raise LiveryError(f"{out} already exists")
    flank = "side" if "side.left" in profile.zones else sorted(profile.zones)[0].split(".")[0]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        f"""version: 1
car: {args.car}
name: {args.name}
number_mode: custom

art_direction: >
  Describe the look in words first — it is what an agent reads before it touches
  a layer. Colours, mood, what should be loud, what should stay quiet.

palette:
  ink: "#0B0D10"
  signal: "#FF3B1F"
  bone: "#F2EFE8"

base:
  color: palette.ink
  material: satin

layers:
  - id: flank-band
    kind: band
    zones: [{flank}]
    rect: [0.10, 0.55, 0.80, 0.22]
    color: palette.signal
    material: gloss

sponsors: []

numbers:
  value: "{args.number}"
  zones: {json.dumps(numbers)}
  color: palette.bone
  outline: {{color: palette.ink, width: 0.05}}
  size: {{h: 0.5}}
""",
        encoding="utf-8",
    )
    print(f"wrote {out}")
    print(f"next: livery build {out} --preview")
    return 0


def cmd_doctor(args) -> int:
    config = _config(args)
    checks = doctormod.run(config, args.car)
    for check in checks:
        print(check.line())
    warns, fails = doctormod.summarize(checks)
    print(f"\n{len(checks)} checks — {fails} failed, {warns} warnings")
    return 1 if fails else 0


def cmd_swatches(args) -> int:
    config = _config(args)
    materials = default_library()
    out = Path(args.out) if args.out else config.build_dir / args.car / "material-swatches.png"
    sheet = previewmod.swatch_sheet(materials, out)
    print(f"wrote {sheet}")
    print(
        "Paint these onto a car, look at them in the iRacing 3D viewer, then edit "
        "src/livery/data/materials.yaml until the names match what you see."
    )
    return 0


def _registry(config: Config) -> CarRegistry:
    return CarRegistry(config.root / "data" / "cars.json")


def cmd_cars_list(args) -> int:
    config = _config(args)
    registry = _registry(config)
    cars = registry.find(args.filter) if args.filter else sorted(
        registry.cars.values(), key=lambda c: c.car_dirpath
    )
    if not cars:
        print("no cars — run `livery cars scan`")
        return 0
    for car in cars:
        print(f"{car.car_dirpath:28s} {car.car_name}")
    print(f"\n{len(cars)} car(s)")
    return 0


def cmd_cars_scan(args) -> int:
    config = _config(args)
    registry = _registry(config)
    # The install's cars\ folder holds one folder per car you own, named by car_dirpath — the paint folder
    # name. The paint folder adds cars you have paints for (Trading Paints fills it for every car it has
    # downloaded for).
    install_cars = config.iracing_install_dir / "cars" if config.iracing_install_dir else None
    found = registry.scan_disk(install_cars, owned=True) + registry.scan_disk(config.iracing_paint_dir)
    path = registry.save()
    print(f"found {found} new car folder(s); {len(registry.cars)} known → {path}")
    return 0


def cmd_cars_coverage(args) -> int:
    config = _config(args)
    coverage = _registry(config).coverage(config.profiles_dir)
    if args.json:
        print(json.dumps(coverage, indent=2))
        return 0
    counts = coverage["counts"]
    print(f"{coverage['total']} cars known")
    for level, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        if count:
            print(f"  {level:10s} {count}")
    missing = [row["car"] for row in coverage["cars"] if row["confidence"] == "missing"]
    if missing:
        print("\nno profile yet: " + ", ".join(missing[:20]) + (" …" if len(missing) > 20 else ""))
    return 0


def cmd_profile_list(args) -> int:
    config = _config(args)
    paths = sorted(Path(config.profiles_dir).glob("*.yaml"))
    for path in paths:
        try:
            profile = CarProfile.load(path)
            print(f"{profile.car:24s} {profile.confidence:9s} {len(profile.zones):3d} zones  {path.name}")
        except LiveryError as exc:
            print(f"{path.name:24s} BROKEN    {exc}")
    print(f"\n{len(paths)} profile(s) in {config.profiles_dir}")
    return 0


def cmd_profile_show(args) -> int:
    config = _config(args)
    profile = CarProfile.load(find_profile(args.car, [config.profiles_dir]))
    print(f"{profile.car} — {profile.display_name or '(no display name)'}")
    print(f"canvas {profile.canvas[0]}×{profile.canvas[1]}  alpha={profile.alpha}  "
          f"{profile.px_per_meter:.0f} px/m  confidence={profile.confidence}")
    print(f"number zones: {', '.join(profile.number_zones) or '(none)'}")
    print(f"mirror pairs: {', '.join(f'{a}/{b}' for a, b in profile.mirror_pairs()) or '(none)'}")
    print("\nzones:")
    for name, zone in sorted(profile.zones.items()):
        frame = zone.frame
        print(
            f"  {name:22s} {zone.plane:6s} {zone.side:6s} axes={zone.axes} "
            f"{'MIRRORED ' if frame.mirrored else ''}"
            f"{profile.px_per_meter_for(zone):.0f}px/m"
        )
    return 0


def cmd_profile_bootstrap(args) -> int:
    config = _config(args)
    out = Path(config.profiles_dir) / f"{args.car}.yaml"
    if out.exists() and not args.force:
        raise LiveryError(f"{out} exists — pass --force to overwrite")
    if args.blank:
        profile = templatemod.bootstrap_blank(args.car, args.width, args.height)
    else:
        psd = Path(args.psd) if args.psd else config.templates_dir / args.car / f"{args.car}.psd"
        profile = templatemod.bootstrap_from_psd(psd, args.car)
    profile.save(out)
    print(f"wrote {out} ({len(profile.zones)} zones, confidence {profile.confidence})")
    print("next: livery preview <a spec on this car> and fix the zones that are wrong")
    return 0


def cmd_profile_layers(args) -> int:
    config = _config(args)
    psd = Path(args.psd) if args.psd else config.templates_dir / args.car / f"{args.car}.psd"
    hints = templatemod.template_hints(psd)
    print(f"{psd.name}: canvas {hints['canvas'][0]}×{hints['canvas'][1]}, {len(hints['layers'])} layers")
    for layer in hints["layers"]:
        classified = layer["classified"]
        label = f"{'  ' * layer['depth']}{layer['name']}"
        print(f"{label:48s} {'→ ' + '/'.join(classified) if classified else ''}")
    return 0


def cmd_profile_from_bake(args) -> int:
    config = _config(args)
    bake_dir = Path(args.bake) if args.bake else config.templates_dir / args.car / "bake"
    maps = bakemod.load_bake(bake_dir)
    profile = bakemod.profile_from_bake(args.car, maps)
    out = Path(config.profiles_dir) / f"{args.car}.yaml"
    if out.exists() and not args.force:
        raise LiveryError(f"{out} exists — pass --force to overwrite")
    profile.save(out)
    print(f"wrote {out} — {len(profile.zones)} zones derived from geometry, "
          f"{profile.px_per_meter:.0f} px/m")
    return 0


def cmd_art_list(args) -> int:
    config = _config(args)
    library = ArtLibrary(config.art_root)
    logos = (
        {logo.id: logo for logo in library.by_tier(args.tier)} if args.tier else library.index()
    )
    if not logos:
        print(f"no logos in {library.logos_dir} — add one with: livery art import <file> <id>")
        return 0
    for ident, logo in sorted(logos.items()):
        print(
            f"{ident:24s} {logo.tier:12s} {'/'.join(sorted(logo.variants)):28s} "
            f"min {logo.min_height_mm:.0f}mm  {', '.join(logo.affinity)}"
        )
    return 0


def cmd_art_import(args) -> int:
    config = _config(args)
    library = ArtLibrary(config.art_root)
    logo = library.import_logo(
        args.file,
        args.id,
        strip_background=not args.keep_background,
        meta={"tier": args.tier, "min_height_mm": args.min_height_mm},
    )
    print(f"imported {logo.id} → {logo.root} ({', '.join(sorted(logo.variants))})")
    print(f"edit {logo.root / 'logo.yaml'} to set clear space, affinity and colour rules")
    return 0


def cmd_art_palette(args) -> int:
    from PIL import Image

    config = _config(args)
    path = ArtLibrary(config.art_root).resolve_source(args.image)
    entries = extract_palette(Image.open(path), args.count)
    print(f"palette of {path.name}:")
    for entry in entries:
        print(f"  {entry.hex}  {entry.weight:5.1%}")
    print("\npaste into a spec:")
    print("palette:")
    for i, entry in enumerate(entries):
        print(f'  color{i + 1}: "{entry.hex}"')
    return 0


def cmd_bake(args) -> int:
    config = _config(args)
    out = config.templates_dir / args.car / "bake"
    if args.check:
        maps = bakemod.load_bake(out)
        print(f"bake at {out}: {maps.size[0]}×{maps.size[1]}, "
              f"{maps.valid.mean():.1%} of texels covered, "
              f"{len(maps.panel_names)} panels")
        if args.template:
            score = bakemod.uv_match_score(maps, args.template)
            verdict = "matches" if score > 0.55 else "does NOT match"
            print(f"UV overlap with {Path(args.template).name}: {score:.0%} — {verdict} the template")
        return 0
    if not args.mesh:
        raise LiveryError("give --mesh <file.blend|obj|fbx|gltf>, or --check to verify an existing bake")
    bakemod.run_blender(
        args.mesh, out, resolution=args.resolution, blender=config.blender,
        uv_map=args.uv_map, forward=args.forward, up=args.up,
    )
    print(f"baked → {out}")
    print(f"next: livery profile from-bake {args.car}")
    return 0


def cmd_materials(args) -> int:
    library = default_library()
    for name in library.names():
        material = library.resolve(name)
        print(
            f"{name:15s} metallic {material.metallic:3d}  roughness {material.roughness:3d}  "
            f"clearcoat {material.clearcoat:3d}  mask {material.spec_mask:3d}  {material.description}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
