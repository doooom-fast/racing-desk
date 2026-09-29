"""The logo pass, on sheets drawn for the purpose: two flanks that mirror, and a rear panel."""

import re

import numpy as np
import pytest
from PIL import Image, ImageDraw

from livery.fleet import logos

GREEN = (0, 255, 0, 255)
UPPER = [(20, 20), (220, 20), (220, 80), (60, 80)]           # a flank, its front edge raked
LOWER = [(20, 180), (220, 180), (220, 120), (60, 120)]       # its twin, flipped top to bottom
REAR = [(260, 20), (380, 20), (380, 120), (260, 120)]
NUMBER = (150, 130, 215, 170)                                # x0, y0, x1, y1: on the lower flank

LONG_UPPER = [(20, 20), (920, 20), (920, 140), (100, 140)]   # flanks long enough to carry a row
LONG_LOWER = [(20, 380), (920, 380), (920, 260), (100, 260)]
LONG_NUMBER = (700, 280, 900, 360)


def sheet(folder, size, shapes, number):
    wire = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(wire)
    for shape in shapes:
        d.polygon(shape, outline=GREEN, width=2)
    folder.mkdir()
    wire.save(folder / "g_Wire.png")
    blocks = np.zeros((size, size, 4), np.uint8)
    x0, y0, x1, y1 = number
    blocks[y0:y1, x0:x1, 3] = 255
    Image.fromarray(blocks).save(folder / "g_Number_Blocks.png")
    return folder


@pytest.fixture
def work(tmp_path):
    return sheet(tmp_path / "work", 400, (UPPER, LOWER, REAR), NUMBER)


@pytest.fixture
def long_work(tmp_path):
    return sheet(tmp_path / "long", 1000, (LONG_UPPER, LONG_LOWER), LONG_NUMBER)


@pytest.fixture
def art(tmp_path):
    own = tmp_path / "art" / "doooom"
    own.mkdir(parents=True)
    for name in (logos.WORD, logos.LOCKUP, logos.SPEED):
        mark = Image.new("L", (340, 100), 0)
        d = ImageDraw.Draw(mark)
        d.rectangle((20, 40, 320, 70), fill=255)             # a bar,
        d.rectangle((20, 20, 60, 70), fill=255)              # taller at its start: it reads one way only
        mark.save(own / name)
    return logos.Art(tmp_path / "art")


def masks(tmp_path, mode):
    """Every sponsor's mark, 120 x 40: white on a clear ground, or white on black with no ground at all."""
    folder = tmp_path / "art" / "sponsors" / "masks"
    folder.mkdir(parents=True)
    for name, _ in logos.BANDS + logos.GEAR_A + logos.GEAR_B:
        if mode == "RGBA":
            m = np.zeros((40, 120, 4), np.uint8)
            m[..., :3] = 255                                 # white everywhere, as such files are
            m[8:32, 8:112, 3] = 255
        else:
            m = np.zeros((40, 120), np.uint8)
            m[8:32, 8:112] = 255
        Image.fromarray(m).save(folder / f"{name}.png")


def ids(work, *points):
    isl = logos.segment(work)
    return (isl, *(int(isl[y, x]) for x, y in points))


def ink(path):
    return np.asarray(Image.open(path))[..., 3] > 127


def crop(m):
    ys, xs = np.where(m)
    return m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def test_panels_are_found_and_twins_are_detected(work):
    isl, upper, lower, rear = ids(work, (150, 50), (100, 150), (320, 70))
    assert len({upper, lower, rear, 0}) == 4
    assert logos.island_ids(isl) == sorted([upper, lower, rear])
    score, twin, kind, ysum, _ = logos.partner(isl, lower, logos.island_ids(isl))
    assert (twin, kind) == (upper, "flipV") and score > 0.95
    assert abs(ysum - 200) <= 2
    lines = logos.report(work, "testcar")
    assert lines[0] == "== testcar: 3 islands"
    assert sum("pair" in line for line in lines) == 2
    assert [("NUMBER" in line) for line in lines if line.split()[0] == str(lower)] == [True]


def test_marks_land_whole_on_both_sides_and_turned_to_read(work, art):
    isl, upper, lower, rear = ids(work, (150, 50), (100, 150), (320, 70))
    cfg = {"prefix": "t", "flank": [upper, lower], "rear": {"ids": [rear], "rot": 0},
           "word_min": 60, "rear_min": 40, "lock_min": 40}
    lines = logos.place(work, cfg, art)

    word = ink(work / "t_1_word.png")
    assert word.shape == (400, 400)
    near, far = word & (isl == lower), word & (isl == upper)
    assert (word == (near | far)).all()

    # whole: what landed on each flank is the mark's own ink at the width it was placed at, all of it
    placed = next(line for line in lines if line.startswith("word"))
    assert "CLIPPED" not in placed
    w = int(re.search(r"w=(\d+)", placed).group(1))
    mark = art.mark(logos.WORD)
    own = (np.asarray(mark.resize((w, int(mark.size[1] * w / mark.size[0])), Image.LANCZOS)) > 127).sum()
    assert own > 500
    assert abs(int(near.sum()) - own) <= 0.02 * own
    assert abs(int(far.sum()) - own) <= 0.02 * own

    # turned to read: the far side is the near side turned half way round
    a, b = crop(near), np.rot90(crop(far), 2)
    h, wd = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    assert (a[:h, :wd] & b[:h, :wd]).sum() / (a[:h, :wd] | b[:h, :wd]).sum() > 0.9
    # and it reads from its tall end: on the near side that is the left
    left, right = crop(near)[:, :8], crop(near)[:, -8:]
    assert left.sum() > right.sum()

    # the number block is as good as off the panel
    x0, y0, x1, y1 = NUMBER
    assert not word[y0:y1, x0:x1].any()
    assert lines[-1] == "number blocks clear (g_Number_Blocks.png)"

    rear_ink = ink(work / "t_2_rear.png")
    assert rear_ink.sum() > 200 and not (rear_ink & (isl != rear)).any()

    # with no second surface the flank takes a second mark, clear of the first
    second = ink(work / "t_3_lockup.png")
    assert second.sum() > 100
    assert not (second & word).any()


def test_a_mark_that_cannot_land_whole_says_how_much_of_it_did(work, art, monkeypatch):
    isl, upper, lower, rear = ids(work, (150, 50), (100, 150), (320, 70))
    # a far side that always loses ink: the shrinking runs out and the mark goes on as it is
    real = logos.Sheet.loss
    monkeypatch.setattr(logos.Sheet, "loss",
                        lambda self, img, cx, cy, ids_, **kw: real(self, img, cx, cy, ids_, **kw) + (ids_ == [upper]))
    lines = logos.place(work, {"prefix": "t", "flank": [upper, lower], "word_min": 60, "lock_min": 5000}, art)
    placed = next(line for line in lines if line.startswith("word"))
    assert re.search(r"CLIPPED: \d+% landed", placed)


def test_a_row_without_its_masks_is_left_off_and_said_so(work, art):
    isl, upper, lower, rear = ids(work, (150, 50), (100, 150), (320, 70))
    lines = logos.place(work, {"prefix": "t", "flank": [upper, lower], "word_min": 60}, art)
    off = [line for line in lines if "left off: no mask for" in line]
    assert [line.split()[0] for line in off] == ["bands", "gear", "gear"]
    assert not ink(work / "t_5_spon.png").any()


@pytest.mark.parametrize("mode", ["RGBA", "L"])
def test_a_sponsor_row_is_fitted_as_a_group(long_work, art, tmp_path, mode):
    masks(tmp_path, mode)
    isl, upper, lower = ids(long_work, (500, 80), (500, 320))
    # the word and the lockup are kept off (no room at that size), so the flanks are the rows' alone
    lines = logos.place(long_work, {"flank": [upper, lower], "word_min": 5000, "lock_min": 5000,
                                    "bands_min": 40, "gear_min": 40}, art)
    placed = [line for line in lines if line.split()[0] in ("bands", "gear") and "scale" in line]
    assert [line.split()[0] for line in placed][:1] == ["bands"]
    for line in placed:
        assert float(line.rsplit("scale", 1)[1]) >= logos.MINSCALE

    rows = ink(long_work / f"{logos.DEFAULT_PREFIX}_5_spon.png")          # no prefix named: the default
    near, far = rows & (isl == lower), rows & (isl == upper)
    assert near.sum() > 2000 and abs(int(near.sum()) - int(far.sum())) <= 0.03 * near.sum()
    assert (rows == (near | far)).all()
    x0, y0, x1, y1 = LONG_NUMBER
    assert not rows[y0 - 4:y1 + 4, x0 - 4:x1 + 4].any()
    assert lines[-1] == "number blocks clear (g_Number_Blocks.png)"

    # rows of separate marks, not slabs: a clear ground stayed clear
    assert 0.1 < crop(near).mean() < 0.8


def test_a_mask_is_one_band_of_coverage_however_its_file_holds_it(art, tmp_path):
    masks(tmp_path, "RGBA")
    got = art.mask("death")
    assert got.mode == "L" and got.size == (120, 40)
    a = np.asarray(got)
    assert a[20, 60] == 255 and a[2, 2] == 0


def test_a_panel_map_is_found_by_the_cars_folder_however_it_is_written():
    assert logos.panel_config("mx5-mx52016")["prefix"] == "mx5"
    assert logos.panel_config("MX5 mx52016")["prefix"] == "mx5"
    assert logos.panel_config("no such car") is None
