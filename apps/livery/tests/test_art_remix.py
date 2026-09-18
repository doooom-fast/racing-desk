"""The art library and the remix operations applied to supplied source art."""

import pytest
from PIL import Image

from livery import color as colormod
from livery.art import ArtLibrary, legibility_check
from livery.errors import ArtError
from livery.materials import default_library
from livery import remix


@pytest.fixture
def source_art(tmp_path):
    img = Image.new("RGB", (120, 60), (255, 255, 255))
    for x in range(20, 100):
        for y in range(10, 30):
            img.putpixel((x, y), (230, 20, 20))
        for y in range(30, 50):
            img.putpixel((x, y), (20, 20, 200))
    path = tmp_path / "supplied.png"
    img.save(path)
    return path


def test_palette_separates_the_real_colours(source_art):
    palette = remix.extract_palette(Image.open(source_art), 3)
    hexes = {entry.hex for entry in palette}
    assert any(h.startswith("#e") or h.startswith("#d") for h in hexes)  # the red
    assert any(h.startswith("#1") or h.startswith("#2") for h in hexes)  # the blue


def test_background_removal_keeps_the_art(source_art):
    cut = remix.remove_background(Image.open(source_art))
    assert cut.getpixel((0, 0))[3] == 0
    assert cut.getpixel((60, 20))[3] == 255


def test_recolor_maps_one_colour_and_leaves_the_rest(source_art):
    cut = remix.remove_background(Image.open(source_art))
    out = remix.recolor(cut, [((230, 20, 20, 255), (255, 59, 31, 255))])
    assert out.getpixel((60, 20))[:3] == (255, 59, 31)
    assert out.getpixel((60, 40))[:3] == (20, 20, 200)


def test_import_builds_variants_and_metadata(tmp_path, source_art):
    library = ArtLibrary(tmp_path / "art")
    logo = library.import_logo(source_art, "acme", meta={"tier": "primary", "min_height_mm": 90})
    assert set(logo.variants) >= {"default", "light", "dark"}
    assert logo.tier == "primary"
    assert logo.aspect() > 1
    assert library.ids() == ["acme"]


def test_variant_is_chosen_for_the_panel_behind_it(tmp_path, source_art):
    logo = ArtLibrary(tmp_path / "art").import_logo(source_art, "acme")
    assert logo.pick_variant((8, 8, 10, 255)) == "light"
    assert logo.pick_variant((245, 245, 240, 255)) == "dark"


def test_missing_logo_lists_what_exists(tmp_path, source_art):
    library = ArtLibrary(tmp_path / "art")
    library.import_logo(source_art, "acme")
    with pytest.raises(ArtError) as exc:
        library.get("nope")
    assert "acme" in str(exc.value)


def test_legibility_check_converts_pixels_to_millimetres(tmp_path, source_art):
    logo = ArtLibrary(tmp_path / "art").import_logo(source_art, "acme", meta={"min_height_mm": 100})
    assert legibility_check(logo, height_px=33, ppm=440) != []   # 75mm — under the 100mm floor
    assert legibility_check(logo, height_px=88, ppm=440) == []   # 200mm — fine


def test_material_albedo_rule_lifts_metal():
    chrome = default_library().resolve("chrome")
    lifted, note = chrome.apply_albedo_rule((10, 10, 12, 255))
    assert colormod.value_of(lifted) > 0.9
    assert "albedo lifted" in note


def test_gloss_leaves_colour_alone():
    gloss = default_library().resolve("gloss")
    same, note = gloss.apply_albedo_rule((10, 10, 12, 255))
    assert same == (10, 10, 12, 255) and note is None


def test_contrast_ratio_matches_wcag():
    assert colormod.contrast_ratio((0, 0, 0, 255), (255, 255, 255, 255)) == pytest.approx(21.0)
