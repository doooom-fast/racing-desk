"""The fleet build: which cars, their templates, the livery, and what lands in the library.

Nothing here goes to the network or reads the rig: templates are archives made in a temp folder,
and the customer id is the made-up one.
"""

import io
import json
import subprocess
import zipfile

import numpy as np
import pytest
from PIL import Image

from livery import tga
from livery.cli import main
from livery.config import Config
from livery.errors import LiveryError
from livery.fleet import build, cars, patches, shatter, template

ID = "424242"
HOST = f"https://{template.TEMPLATE_HOST}/members/member_images/cars/car_templates"


# ------------------------------------------------------------------ helpers


def row(folder="testcar", url=f"{HOST}/1_template_T.zip"):
    return cars.TemplateRow("Test Car", folder, "T", "1", url)


def zip_bytes(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in members.items():
            z.writestr(name, data)
    return buf.getvalue()


class Opener:
    """Stands in for the network, and counts how often it is asked."""

    def __init__(self, payload: bytes):
        self.payload, self.calls = payload, 0

    def __call__(self, request, timeout=None):
        self.calls += 1
        return self

    def __enter__(self):
        self._stream = io.BytesIO(self.payload)
        return self._stream

    def __exit__(self, *exc):
        return False


def work_folder(cache, folder="testcar", size=64, spec=True, patch=True, numbers=True):
    """A car's work folder as `prepare` leaves it, so a build needs no template."""
    work = template.folder_for(cache, folder) / "work"
    work.mkdir(parents=True)
    guides = []
    if spec:
        s = np.zeros((size, size, 3), np.uint8)
        s[..., 0], s[..., 1], s[..., 2] = 40, 99, 200
        Image.fromarray(s).save(work / "spec_default.png")
    if patch:
        g = np.zeros((size, size, 4), np.uint8)
        g[size - 10:size, 0:12] = (255, 255, 255, 255)
        Image.fromarray(g).save(work / "g_Pitbox_Colors.png")
        guides.append("g_Pitbox_Colors.png")
    if numbers:
        g = np.zeros((size, size, 4), np.uint8)
        g[20:30, 20:40, 3] = 255
        Image.fromarray(g).save(work / "g_Number_Blocks.png")
        guides.append("g_Number_Blocks.png")
    (work / "extract.json").write_text(json.dumps(
        {"size": [size, size], "spec": spec, "guides": guides, "schemes": [], "skipped": []}))
    return work


def flat(value, size=64, box=None):
    a = np.zeros((size, size, 4), np.uint8)
    if box is None:
        a[...] = (*value, 255)
    else:
        x0, y0, x1, y1 = box
        a[y0:y1, x0:x1] = (*value, 255)
    return Image.fromarray(a)


def template_psd(path, spec=True):
    """A template of the kind iRacing publishes, 64 pixels across."""
    psd_tools = pytest.importorskip("psd_tools")
    psd = psd_tools.PSDImage.new("RGB", (64, 64))
    if not hasattr(psd, "create_pixel_layer"):
        pytest.skip("this psd-tools cannot write a PSD")
    psd.create_pixel_layer(flat((0, 255, 0), box=(4, 4, 60, 60)), name="Wire")
    psd.create_pixel_layer(flat((255, 255, 255), box=(0, 54, 12, 64)), name="Pitbox Colors")
    psd.create_pixel_layer(flat((255, 255, 255), box=(20, 20, 40, 30)), name="Number Blocks")
    psd.create_pixel_layer(flat((200, 10, 10)), name="Paint")
    if spec:
        group = psd.create_group(name="Spec Map")
        for name, v in (("Red Channel Metallic", 40), ("Green Channel Roughness", 99), ("Blue Channel Clearcoat", 200)):
            channel = psd.create_group(name=name)
            channel.append(psd.create_pixel_layer(flat((v, v, v)), name=name + " fill"))
            group.append(channel)
    psd.save(path)
    return path


@pytest.fixture
def field(tmp_path):
    """A shard field: nothing on the left, full strength on the right, a ramp between."""
    a = np.tile(np.linspace(0, 1, 64), (64, 1))
    path = tmp_path / "field.png"
    Image.fromarray((a * 65535).round().astype(np.uint16)).save(path)
    return path


# --------------------------------------------------------------------- cars


def test_folder_names_fold_the_way_the_desk_folds_them():
    assert cars.fold("mx5-mx52016") == cars.fold("mx5 mx52016") == "mx5 mx52016"
    assert cars.fold("  Caterham_Caterham420R ") == "caterham caterham420r"
    assert cars.fold("a--b") == "a b"


def test_the_template_table_names_only_iracings_own_addresses():
    rows = cars.load()
    assert len(rows) > 100
    assert len({cars.fold(r.paint_folder) for r in rows}) == len(rows)
    for r in rows:
        assert r.template_zip.startswith(f"https://{template.TEMPLATE_HOST}/"), r.paint_folder
        assert r.template_zip.endswith(".zip")
    assert cars.for_folder(rows, "MX5-mx52016").paint_folder == "mx5 mx52016"
    assert cars.for_folder(rows, "no such car") is None


@pytest.fixture
def install(tmp_path):
    root = tmp_path / "iRacing"
    for path in ("lotus79/lotus79.dat", "mx5/mx5.dat", "mx5/mx52016/car.dat", "mx5/cup/car.dat",
                 "fordgt/fordgt.dat", "fordgt/gt3/gt3.dat", "caterham/caterham420r/car.dat",
                 "a/b/c/d/d.dat", "a/b/c/d/e/e.dat", "safety/pacecar/car.dat", "empty/readme.txt"):
        f = root / "cars" / path
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"")
    return root


def test_the_install_is_walked_for_cars_and_for_what_cars_are_built_on(install, tmp_path):
    certain, families = cars.walk(install)
    assert certain == ["a b c d", "caterham caterham420r", "fordgt gt3", "lotus79", "mx5 cup", "mx5 mx52016"]
    assert families == ["fordgt", "mx5"]
    assert cars.installed(install) == certain
    assert cars.walk(None) == ([], [])
    assert cars.walk(tmp_path / "nowhere") == ([], [])


def test_a_family_is_a_car_when_something_knows_it_as_one(install, tmp_path):
    rows = [row("fordgt"), row("fordgt gt3"), row("lotus79")]
    assert "fordgt" in cars.on_the_rig(install, rows)
    assert "mx5" not in cars.on_the_rig(install, rows)
    lib = tmp_path / "cars"
    (lib / "mx5" / "v1").mkdir(parents=True)
    (lib / "mx5" / "v1" / f"car_{ID}.tga").write_bytes(b"x")
    assert "mx5" in cars.on_the_rig(install, rows, lib)


def test_a_car_is_painted_when_a_version_of_it_holds_a_paint(tmp_path):
    lib = tmp_path / "cars"
    (lib / "mx5-mx52016" / "shatter").mkdir(parents=True)
    (lib / "mx5-mx52016" / "shatter" / f"car_{ID}.tga").write_bytes(b"x")
    (lib / "onlyspec" / "v1").mkdir(parents=True)
    (lib / "onlyspec" / "v1" / f"car_spec_{ID}.tga").write_bytes(b"x")
    (lib / ".backups" / "v1").mkdir(parents=True)
    (lib / ".backups" / "v1" / "car.tga").write_bytes(b"x")
    assert cars.painted(lib) == {"mx5 mx52016": "mx5-mx52016"}
    assert build.customer_id(lib) == ID
    assert build.customer_id(tmp_path / "nowhere") is None


# ----------------------------------------------------------------- template


@pytest.mark.parametrize("url", [
    "http://ir-core-sites.iracing.com/a/1_template_T.zip",
    "https://example.com/a/1_template_T.zip",
    "https://ir-core-sites.iracing.com.example.com/a/1_template_T.zip",
    "https://ir-core-sites.iracing.com/a/1_template_T.exe",
    "file:///C:/Windows/win.ini",
])
def test_a_template_is_fetched_from_iracing_or_not_at_all(tmp_path, url):
    opener = Opener(zip_bytes({"Car.psd": b"8BPS"}))
    with pytest.raises(LiveryError):
        template.fetch(row(url=url), tmp_path, opener=opener)
    assert opener.calls == 0


def test_being_sent_on_to_another_host_is_not_followed():
    import urllib.request

    handler = template._StayWithIRacing()
    request = urllib.request.Request(f"{HOST}/1_template_T.zip")
    for elsewhere in ("https://example.com/1_template_T.zip", f"http://{template.TEMPLATE_HOST}/x.zip"):
        with pytest.raises(LiveryError):
            handler.redirect_request(request, None, 302, "Found", {}, elsewhere)
    onward = handler.redirect_request(request, None, 302, "Found", {}, f"{HOST}/moved/1_template_T.zip")
    assert onward.full_url == f"{HOST}/moved/1_template_T.zip"


def test_a_template_is_fetched_once(tmp_path):
    opener = Opener(zip_bytes({"Car.psd": b"8BPS"}))
    first = template.fetch(row(), tmp_path, opener=opener)
    assert first == tmp_path / "testcar" / "1_template_T.zip"
    assert template.fetch(row(), tmp_path, opener=opener) == first
    assert opener.calls == 1


def test_what_is_not_an_archive_is_not_kept(tmp_path):
    with pytest.raises(LiveryError):
        template.fetch(row(), tmp_path, opener=Opener(b"<html>not found</html>"))
    assert list((tmp_path / "testcar").iterdir()) == []


@pytest.mark.parametrize("member", ["../../outside.psd", "sub/C:outside.psd", "C:\\Windows\\outside.psd",
                                    "/outside.psd", "outside.psd:stream.psd"])
def test_an_archive_does_not_choose_where_its_files_land(tmp_path, member):
    archive = tmp_path / "t.zip"
    archive.write_bytes(zip_bytes({
        member: b"the template itself, and the largest psd here",
        "__MACOSX/._Car.psd": b"a resource fork, and the largest thing in the archive" * 4,
        "folder/Car.psd": b"smaller",
        "readme.txt": b"no",
    }))
    into = tmp_path / "a" / "b" / "into"
    psd = template.unpack(archive, into)
    assert psd.parent == into
    assert psd.read_bytes() == b"the template itself, and the largest psd here"
    assert [p.name for p in into.iterdir()] == [psd.name]
    assert [p for p in tmp_path.rglob("*.psd")] == [psd]          # and nothing anywhere else


def test_an_archive_without_a_psd_says_so(tmp_path):
    archive = tmp_path / "t.zip"
    archive.write_bytes(zip_bytes({"Car.tga": b"x", ".psd": b"no name", "__MACOSX/._Car.psd": b"fork"}))
    assert template.unpack(archive, tmp_path / "into") is None


@pytest.mark.parametrize("name", ["..", "", "a/b", "a\\b", "c:evil", "what?"])
def test_a_cache_folder_is_a_plain_name(tmp_path, name):
    with pytest.raises(LiveryError):
        template.folder_for(tmp_path, name)


def test_a_template_is_read_for_what_a_build_needs(tmp_path):
    psd = template_psd(tmp_path / "Car.psd")
    info = template.extract(psd, tmp_path / "work")
    assert info["size"] == [64, 64]
    assert sorted(info["guides"]) == ["g_Number_Blocks.png", "g_Pitbox_Colors.png", "g_Wire.png"]
    assert (info["spec"], info["spec_channels"], info["skipped"]) == (True, ["red", "green", "blue"], [])
    assert sorted(p.name for p in (tmp_path / "work").iterdir()) == [
        "g_Number_Blocks.png", "g_Pitbox_Colors.png", "g_Wire.png", "spec_default.png"]
    # each channel group went into its own channel
    assert np.asarray(Image.open(tmp_path / "work" / "spec_default.png"))[10, 10].tolist() == [40, 99, 200]
    # and the guides are what the rest of the build looks for them as
    assert patches.colour_patches(tmp_path / "work") == [(0, 12, 54, 64)]
    assert patches.number_guide(tmp_path / "work").endswith("g_Number_Blocks.png")


def test_a_template_without_a_spec_map_gives_none(tmp_path):
    info = template.extract(template_psd(tmp_path / "Car.psd", spec=False), tmp_path / "work")
    assert (info["spec"], info["spec_channels"]) == (False, [])
    assert not (tmp_path / "work" / "spec_default.png").exists()


def test_a_layer_that_cannot_be_drawn_is_left_out_unless_the_build_needs_it(tmp_path, monkeypatch):
    import psd_tools

    psd = template_psd(tmp_path / "Car.psd")
    real = psd_tools.PSDImage.composite
    broken = {"name": "Wire"}

    def composite(self, *args, **kwargs):
        if any(l.visible and l.name == broken["name"] for l in self):
            raise ImportError("No module named 'aggdraw'\nand a second line")
        return real(self, *args, **kwargs)

    monkeypatch.setattr(psd_tools.PSDImage, "composite", composite)
    info = template.extract(psd, tmp_path / "work")
    assert info["skipped"] == [{"layer": "Wire", "why": "ImportError: No module named 'aggdraw'"}]
    assert "g_Wire.png" not in info["guides"] and "g_Pitbox_Colors.png" in info["guides"]

    broken["name"] = "Pitbox Colors"
    with pytest.raises(LiveryError, match="Pitbox Colors"):
        template.extract(psd, tmp_path / "work2")


def test_a_cars_template_is_fetched_read_and_let_go(tmp_path):
    template_psd(tmp_path / "Car.psd")
    opener = Opener(zip_bytes({"Car.psd": (tmp_path / "Car.psd").read_bytes()}))
    cache = tmp_path / "cache"

    work, info = build.prepare(row(), cache, opener=opener)
    home = cache / "testcar"
    assert work == home / "work" and info["template"] == row().template_zip
    assert sorted(p.name for p in home.iterdir()) == ["1_template_T.zip", "work"]      # the PSD is gone
    assert json.loads((work / "extract.json").read_text())["size"] == [64, 64]

    again, _ = build.prepare(row(), cache, opener=opener)
    assert again == work and opener.calls == 1

    # a note that vouches for a file that is not there vouches for nothing
    (work / "g_Pitbox_Colors.png").unlink()
    build.prepare(row(), cache, opener=opener)
    assert (work / "g_Pitbox_Colors.png").exists()
    assert opener.calls == 1                                                          # the archive was kept


# ------------------------------------------------------------------ patches


def test_colour_patches_come_from_the_templates_own_guides(tmp_path):
    work = work_folder(tmp_path)
    assert patches.colour_patches(work) == [(0, 12, 54, 64)]
    assert patches.number_guide(work).endswith("g_Number_Blocks.png")
    blocks = patches.number_blocks(work, pad=2)
    assert blocks[20:30, 20:40].all() and blocks[18, 20] and not blocks[10, 10]


def test_a_car_without_the_guides_has_no_patches(tmp_path):
    work = work_folder(tmp_path, patch=False, numbers=False)
    assert patches.colour_patches(work) == []
    assert patches.number_guide(work) is None
    assert patches.number_blocks(work) is None


# ------------------------------------------------------------------ shatter


def test_a_shard_is_art_over_body_and_gloss_over_matte(field):
    a = shatter.load_field(field, (64, 64))
    spec_t = np.zeros((64, 64, 3), np.uint8)
    spec_t[..., 0], spec_t[..., 2] = 40, 200
    sheet, spec = shatter.paint(a, shatter.BLACK, shatter.ORANGE, spec_t, patches=[(0, 12, 54, 64)])
    assert sheet[0, 0].tolist() == [10, 10, 10]            # no field: the body
    assert sheet[0, 63].tolist() == [220, 55, 20]          # full field: the art
    assert sheet[60, 5].tolist() == [220, 55, 20]          # the pit-box patch, which has no field at all
    assert (spec[0, 0].tolist(), spec[0, 63].tolist()) == ([40, 255, 200], [40, 22, 200])


def test_logos_are_white_and_glossy_and_no_template_means_no_spec_map(field):
    a = shatter.load_field(field, (64, 64))
    logos = np.zeros((64, 64))
    logos[5:10, 5:10] = 1.0
    spec_t = np.full((64, 64, 3), 7, np.uint8)
    sheet, spec = shatter.paint(a, shatter.ORANGE, shatter.BLACK, spec_t, logos=logos)
    assert sheet[7, 7].tolist() == [238, 238, 238]
    assert sheet[0, 0].tolist() == [220, 55, 20]
    assert spec[7, 7].tolist() == [7, 22, 7]               # a logo is glossy, on a body that is not
    assert spec[0, 0].tolist() == [7, 255, 7]
    assert shatter.paint(a, shatter.ORANGE, shatter.BLACK, None)[1] is None


def test_logo_layers_are_read_from_the_work_folder(tmp_path):
    layer = np.zeros((64, 64, 4), np.uint8)
    layer[5:10, 5:10, 3] = 255
    Image.fromarray(layer).save(tmp_path / "m2_1_word.png")
    Image.fromarray(layer[:32, :32]).save(tmp_path / "m2_preview.png")       # a preview: not a sheet
    Image.fromarray(layer).save(tmp_path / "other_1_word.png")
    got = shatter.logo_layers(tmp_path, "m2_*.png", (64, 64))
    assert got[7, 7] == 1 and got.sum() == 25
    assert shatter.logo_layers(tmp_path, "none_*.png", (64, 64)).sum() == 0


def test_the_field_is_laid_on_a_sheet_of_any_size(field):
    same = shatter.load_field(field, (64, 64))
    assert same.shape == (64, 64) and same[0, 0] == 0 and same[0, 63] == 1
    big = shatter.load_field(field, (128, 128))
    assert big.shape == (128, 128)
    assert big.min() >= 0 and big.max() <= 1
    assert abs(big[:, 64].mean() - 0.5) < 0.02            # the ramp is still a ramp
    wide = shatter.load_field(field, (128, 64))
    assert wide.shape == (64, 128)


def test_the_fleets_own_field_is_the_size_of_a_sheet_and_deep(repo_root):
    path = repo_root / "art" / shatter.FIELD_NAME
    with Image.open(path) as im:
        assert im.size == (2048, 2048) and im.mode.startswith("I")
    a = shatter.load_field(path, (2048, 2048))
    assert a.min() < 0.01 and a.max() > 0.99
    assert 0.40 < (a > 0.04).mean() < 0.55                # about half the sheet carries art


def test_a_field_is_made_from_shattered_artwork(tmp_path):
    art = np.zeros((100, 200, 4), np.uint8)
    art[..., :3] = 255                                     # pale, and clear on the left half
    art[:, 100:, :3] = 0                                   # dark on the right half
    art[:, 100:, 3] = 255
    path = tmp_path / "raster.png"
    Image.fromarray(art).save(path)
    a = shatter.field_from_raster(path, 64)
    assert a.shape == (64, 64)
    assert a[32, 2] == 0 and a[32, 61] == 1
    assert shatter.field_from_raster(path, 64, flip=True)[32, 2] == 1


# -------------------------------------------------------------------- build


def test_a_car_is_built_into_the_library_in_both_directions(tmp_path, field):
    cache, lib = tmp_path / "cache", tmp_path / "cars"
    work_folder(cache)
    done = build.build_car("testcar", row(), lib, cache, ID, field, today="2026-09-28")
    assert done.outcome == "built"
    assert (done.size, done.patches, done.numbers, done.spec, done.logos) == ([64, 64], 1, True, True, False)
    for mode in ("shatter", "shatter-inverted"):
        d = lib / "testcar" / mode
        assert sorted(p.name for p in d.iterdir()) == [f"car_{ID}.tga", f"car_spec_{ID}.tga", "meta.json"]
        paint = Image.open(d / f"car_{ID}.tga")
        assert (paint.mode, paint.size, paint.info.get("compression")) == ("RGB", (64, 64), "tga_rle")
        meta = json.loads((d / "meta.json").read_text())
        assert sorted(meta) == ["built", "created", "name", "notes", "source"]
        assert (meta["name"], meta["created"], meta["source"]) == (mode, "2026-09-28", build.SOURCE)
        # what the desk reads of it is strings; and no folder is named, so the desk finds or makes the car's own
        assert all(isinstance(meta[k], str) for k in ("name", "created", "source", "notes"))
        assert "simFolder" not in meta
        assert build.state_of(lib, "testcar", mode) == "ours"
    body = np.asarray(Image.open(lib / "testcar" / "shatter-inverted" / f"car_{ID}.tga"))
    assert body[0, 0].tolist() == [220, 55, 20]


def test_a_build_never_writes_over_a_paint_it_did_not_make(tmp_path, field):
    cache, lib = tmp_path / "cache", tmp_path / "cars"
    work_folder(cache)
    hand = lib / "testcar" / "shatter"
    hand.mkdir(parents=True)
    (hand / f"car_{ID}.tga").write_bytes(b"made by hand")

    done = build.build_car("testcar", row(), lib, cache, ID, field)
    assert (done.versions, done.kept) == (["shatter-inverted"], ["shatter"])
    forced = build.build_car("testcar", row(), lib, cache, ID, field, force=True)
    assert forced.versions == ["shatter-inverted"]          # its own, rebuilt; the other left alone
    assert (hand / f"car_{ID}.tga").read_bytes() == b"made by hand"
    assert sorted(p.name for p in hand.iterdir()) == [f"car_{ID}.tga"]
    assert build.build_car("testcar", row(), lib, cache, ID, field).outcome == "there"


@pytest.mark.parametrize("left_behind", [
    {"car_spec_424242.tga": b"someone's spec map"},
    {"meta.json": b'{"name": "mine", "source": "made by hand"}'},
    {"meta.json": b"not json", "preview.png": b"x"},
])
def test_a_folder_that_is_someone_elses_is_left_alone_even_without_a_paint(tmp_path, field, left_behind):
    cache, lib = tmp_path / "cache", tmp_path / "cars"
    work_folder(cache)
    theirs = lib / "testcar" / "shatter"
    theirs.mkdir(parents=True)
    for name, data in left_behind.items():
        (theirs / name).write_bytes(data)
    done = build.build_car("testcar", row(), lib, cache, ID, field, force=True)
    assert (done.versions, done.kept) == (["shatter-inverted"], ["shatter"])
    assert {p.name: p.read_bytes() for p in theirs.iterdir()} == left_behind


def test_a_paint_changed_since_the_build_wrote_it_is_no_longer_the_builds(tmp_path, field):
    cache, lib = tmp_path / "cache", tmp_path / "cars"
    work_folder(cache)
    build.build_car("testcar", row(), lib, cache, ID, field)
    paint = lib / "testcar" / "shatter" / f"car_{ID}.tga"
    Image.new("RGB", (64, 64), (1, 2, 3)).save(paint, format="TGA")       # reworked by hand
    assert build.state_of(lib, "testcar", "shatter") == "theirs"
    forced = build.build_car("testcar", row(), lib, cache, ID, field, force=True)
    assert (forced.versions, forced.kept) == (["shatter-inverted"], ["shatter"])
    assert np.asarray(Image.open(paint))[0, 0].tolist() == [1, 2, 3]


def test_a_build_stopped_part_way_is_finished_by_the_next(tmp_path, field, monkeypatch):
    cache, lib = tmp_path / "cache", tmp_path / "cars"
    work_folder(cache)
    real, calls = tga.save_tga, []

    def stops_at_the_paint(img, path, **kwargs):
        calls.append(path.name)
        if path.name == f"car_{ID}.tga":
            raise KeyboardInterrupt()
        return real(img, path, **kwargs)

    monkeypatch.setattr(build, "save_tga", stops_at_the_paint)
    with pytest.raises(KeyboardInterrupt):
        build.build_car("testcar", row(), lib, cache, ID, field)
    d = lib / "testcar" / "shatter"
    assert sorted(p.name for p in d.iterdir()) == [f"car_spec_{ID}.tga", "meta.json"]    # no paint, no leavings
    assert build.state_of(lib, "testcar", "shatter") == "unfinished"
    assert not build.version_there(lib, "testcar", "shatter")

    monkeypatch.setattr(build, "save_tga", real)
    done = build.build_car("testcar", row(), lib, cache, ID, field)
    assert done.versions == ["shatter", "shatter-inverted"]
    assert build.state_of(lib, "testcar", "shatter") == "ours"


def test_a_car_goes_into_the_folder_the_library_already_has_for_it(tmp_path, field):
    cache, lib = tmp_path / "cache", tmp_path / "cars"
    work_folder(cache, "mx5 mx52016")
    (lib / "mx5-mx52016" / "v10").mkdir(parents=True)
    (lib / "mx5-mx52016" / "v10" / f"car_{ID}.tga").write_bytes(b"x")
    done = build.build_car("mx5 mx52016", row("mx5 mx52016"), lib, cache, ID, field)
    assert done.outcome == "built"
    assert (lib / "mx5-mx52016" / "shatter" / f"car_{ID}.tga").exists()
    assert not (lib / "mx5 mx52016").exists()


def test_a_car_whose_template_has_no_spec_map_gets_the_paint_alone(tmp_path, field):
    cache, lib = tmp_path / "cache", tmp_path / "cars"
    work_folder(cache, spec=False)
    done = build.build_car("testcar", row(), lib, cache, ID, field)
    assert (done.outcome, done.spec) == ("built", False)
    assert sorted(p.name for p in (lib / "testcar" / "shatter").iterdir()) == [f"car_{ID}.tga", "meta.json"]
    assert "no spec map" in json.loads((lib / "testcar" / "shatter" / "meta.json").read_text())["notes"]


def test_a_car_with_logo_layers_wears_them(tmp_path, field, monkeypatch):
    cache, lib = tmp_path / "cache", tmp_path / "cars"
    work = work_folder(cache)
    panels = tmp_path / "panels"
    panels.mkdir()
    (panels / "testcar.json").write_text('{"flank": [1, 2]}')             # a map that names no prefix
    monkeypatch.setattr(build, "PANELS", panels)
    layer = np.zeros((64, 64, 4), np.uint8)
    layer[5:10, 5:10, 3] = 255
    Image.fromarray(layer).save(work / f"{shatter.DEFAULT_PREFIX}_1_word.png")
    done = build.build_car("testcar", row(), lib, cache, ID, field)
    assert done.logos
    assert np.asarray(Image.open(lib / "testcar" / "shatter" / f"car_{ID}.tga"))[7, 7].tolist() == [238, 238, 238]


def test_one_cars_trouble_is_not_the_fleets(tmp_path, field):
    cache, lib = tmp_path / "cache", tmp_path / "cars"
    work_folder(cache, "good")
    empty = Opener(zip_bytes({"readme.txt": b"no psd here"}))
    lines = []
    results = build.build_fleet(
        ["unknown", "nopsd", "good"], lib, cache, ID, field,
        rows=[row("nopsd"), row("good")], busy=lambda: False, log=lines.append,
        report=tmp_path / "report.json", opener=empty,
    )
    assert [r.outcome for r in results] == ["no-template", "no-psd", "built"]
    report = json.loads((tmp_path / "report.json").read_text())
    assert report["counts"] == {"no-template": 1, "no-psd": 1, "built": 1}
    assert not (template.folder_for(cache, "nopsd") / "work").exists()
    assert len(lines) == 3


def test_the_fleet_waits_while_the_sim_runs_and_while_it_cannot_tell(tmp_path, field):
    cache, lib = tmp_path / "cache", tmp_path / "cars"
    work_folder(cache)
    answers = iter([True, True, None, False, False, False])
    slept, lines = [], []
    results = build.build_fleet(
        ["testcar"], lib, cache, ID, field, rows=[row()],
        busy=lambda: next(answers), sleep=slept.append, wait_seconds=7, log=lines.append,
    )
    assert slept == [7, 7, 7]
    assert lines[:2] == ["the sim is running: waiting", "cannot tell whether the sim is running: waiting"]
    assert results[0].outcome == "built"


def test_the_sim_is_asked_about_between_the_steps_of_a_car(tmp_path, field):
    template_psd(tmp_path / "Car.psd")
    opener = Opener(zip_bytes({"Car.psd": (tmp_path / "Car.psd").read_bytes()}))
    asked = []
    done = build.build_car("testcar", row(), tmp_path / "cars", tmp_path / "cache", ID, field,
                           opener=opener, hold=lambda: asked.append(1))
    assert done.outcome == "built"
    assert len(asked) == 2                     # before the template is read, and before the paint is made


def test_the_limit_counts_cars_built_not_cars_tried(tmp_path, field):
    cache, lib = tmp_path / "cache", tmp_path / "cars"
    for name in ("one", "two", "three"):
        work_folder(cache, name)
    results = build.build_fleet(
        ["unknown", "one", "two", "three"], lib, cache, ID, field,
        rows=[row("one"), row("two"), row("three")], busy=lambda: False, log=lambda line: None, limit=2,
    )
    assert [(r.car, r.outcome) for r in results] == [("unknown", "no-template"), ("one", "built"), ("two", "built")]


def fake_tasklist(stdout="", returncode=0, raises=None):
    def run(*args, **kwargs):
        if raises:
            raise raises
        return subprocess.CompletedProcess(args, returncode, stdout=stdout, stderr="")
    return run


@pytest.mark.skipif(not hasattr(subprocess, "CREATE_NO_WINDOW"), reason="the sim runs on Windows")
def test_whether_the_sim_runs_is_yes_no_or_cannot_tell():
    quiet = '"System Idle Process","0","Services","0","8 K"\n"explorer.exe","4321","Console","1","90,000 K"\n'
    assert build.sim_running(fake_tasklist(quiet)) is False
    assert build.sim_running(fake_tasklist(quiet + '"iRacingSim64DX11.exe","77","Console","1","4,000,000 K"\n')) is True
    assert build.sim_running(fake_tasklist(quiet + '"iRacingSim64.exe","77","Console","1","4,000,000 K"\n')) is True
    assert build.sim_running(fake_tasklist("")) is None
    assert build.sim_running(fake_tasklist(quiet, returncode=1)) is None
    assert build.sim_running(fake_tasklist(raises=subprocess.TimeoutExpired("tasklist", 30))) is None
    assert build.sim_running(fake_tasklist(raises=OSError("no tasklist"))) is None


# ------------------------------------------------------- the customer id


def test_nothing_is_printed_or_written_with_an_id_but_the_file_names(tmp_path, field):
    cache, lib = tmp_path / "cache", tmp_path / "cars"
    work_folder(cache)
    lines = []
    build.build_fleet(["testcar"], lib, cache, ID, field, rows=[row()], busy=lambda: False,
                      log=lines.append, report=tmp_path / "report.json")
    assert ID not in "\n".join(lines)
    assert ID not in (tmp_path / "report.json").read_text()
    assert ID not in (lib / "testcar" / "shatter" / "meta.json").read_text()


def test_a_write_that_fails_does_not_say_the_id(tmp_path, field, monkeypatch):
    cache, lib = tmp_path / "cache", tmp_path / "cars"
    work_folder(cache)

    def refuses(img, path, **kwargs):
        raise PermissionError(13, "Permission denied\nand more", str(path))

    monkeypatch.setattr(build, "save_tga", refuses)
    lines = []
    results = build.build_fleet(["testcar"], lib, cache, ID, field, rows=[row()], busy=lambda: False,
                                log=lines.append, report=tmp_path / "report.json")
    assert results[0].outcome == "failed"
    assert "car_<id>.tga" in results[0].detail or "car_spec_<id>.tga" in results[0].detail
    assert "\n" not in results[0].detail
    assert ID not in "\n".join(lines) and ID not in (tmp_path / "report.json").read_text()


@pytest.mark.parametrize("ident", ["", "abc", "42 42", "../424242", "424242.tga", "4" * 11, None])
def test_a_customer_id_is_a_number_or_nothing_is_written(tmp_path, field, ident):
    cache, lib = tmp_path / "cache", tmp_path / "cars"
    work_folder(cache)
    with pytest.raises(LiveryError):
        build.build_car("testcar", row(), lib, cache, ident, field)
    assert not lib.exists()


# ---------------------------------------------------------------- the command


@pytest.fixture
def rig(tmp_path, install, repo_root, monkeypatch):
    """A rig in a temp folder: an install, a library, a config that names them, the fleet's own field."""
    lib = tmp_path / "library"
    (lib / "lotus79" / "v10").mkdir(parents=True)
    (lib / "lotus79" / "v10" / f"car_{ID}.tga").write_bytes(b"x")
    root = tmp_path / "project"
    root.mkdir()
    (root / "livery.yaml").write_text(
        f"iracing_install_dir: '{install.as_posix()}'\nlibrary_dir: '{lib.as_posix()}'\n"
        f"art_root: '{(repo_root / 'art').as_posix()}'\n")
    for name in ("LIVERY_CUSTOMER_ID", "IRACING_CUSTOMER_ID", "LIVERY_LIBRARY_DIR", "LIVERY_IRACING_INSTALL_DIR"):
        monkeypatch.delenv(name, raising=False)
    return root, lib


def test_status_counts_every_car_on_the_rig(rig, capsys):
    root, lib = rig
    assert main(["--root", str(root), "fleet", "status", "--json"]) == 0
    status = {s["car"]: s for s in json.loads(capsys.readouterr().out)["cars"]}
    assert sorted(status) == ["a b c d", "caterham caterham420r", "fordgt", "fordgt gt3", "lotus79",
                              "mx5 cup", "mx5 mx52016"]
    assert status["fordgt"]["template"] and status["lotus79"]["painted"] and not status["lotus79"]["has"]
    assert not status["a b c d"]["template"]


def test_a_rig_with_no_install_says_so(tmp_path, capsys, monkeypatch):
    for name in ("LIVERY_LIBRARY_DIR", "LIVERY_IRACING_INSTALL_DIR"):
        monkeypatch.delenv(name, raising=False)
    (tmp_path / "livery.yaml").write_text(f"iracing_install_dir: '{(tmp_path / 'nowhere').as_posix()}'\n")
    assert main(["--root", str(tmp_path), "fleet", "status"]) == 1
    assert main(["--root", str(tmp_path), "fleet", "build"]) == 1
    assert "no cars found" in capsys.readouterr().err


def test_the_command_builds_what_is_missing_and_force_rebuilds_its_own(rig, tmp_path, capsys, monkeypatch):
    root, lib = rig
    cache = tmp_path / "cache"
    work_folder(cache, "lotus79", size=64)
    monkeypatch.setattr(build, "sim_running", lambda: False)

    def no_network(request, timeout=None):
        raise LiveryError("no network in a test")

    monkeypatch.setattr(template, "_open", no_network)
    args = ["--root", str(root), "fleet", "build", "--cache", str(cache), "--limit", "1"]

    assert main(args) == 1                       # cars with no work folder and no network fail; one is built
    out = capsys.readouterr().out
    assert "lotus79" in out and ID not in out
    paint = lib / "lotus79" / "shatter" / f"car_{ID}.tga"           # the id came from the library's own paints
    assert paint.exists()
    assert (lib / "lotus79" / "v10" / f"car_{ID}.tga").read_bytes() == b"x"

    before = paint.stat().st_mtime_ns
    assert main(["--root", str(root), "fleet", "build", "lotus79", "--cache", str(cache)]) == 0
    assert paint.stat().st_mtime_ns == before                        # there already: not touched
    assert main(["--root", str(root), "fleet", "build", "lotus79", "--cache", str(cache), "--force"]) == 0
    assert paint.stat().st_mtime_ns != before


# ------------------------------------------------------------------ config


def test_a_blank_library_is_no_library_and_a_relative_one_is_beside_the_config(tmp_path, monkeypatch):
    monkeypatch.delenv("LIVERY_LIBRARY_DIR", raising=False)
    (tmp_path / "livery.yaml").write_text('library_dir: ""\n')
    blank = Config.load(tmp_path)
    assert blank.library_dir is None
    assert blank.library() == blank.iracing_paint_dir / "doooom-iRacing-liveries" / "cars"

    (tmp_path / "livery.yaml").write_text("library_dir: paints/cars\n")
    assert Config.load(tmp_path).library() == (tmp_path / "paints" / "cars").resolve()

    monkeypatch.setenv("LIVERY_LIBRARY_DIR", str(tmp_path / "elsewhere"))
    assert Config.load(tmp_path).library() == tmp_path / "elsewhere"
