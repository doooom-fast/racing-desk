"""End-to-end rendering: the paint that comes out, and the checks that fire."""

import numpy as np
import pytest
from PIL import Image

from livery.canvas import PaintCanvas
from livery.materials import default_library
from livery.render import Renderer
from livery.spec import Element, LiverySpec
from livery import place


def build(spec, profile, art_library):
    return Renderer(spec, profile, art_library).render()


def test_demo_livery_builds_clean(demo_spec, demo_profile, art_library):
    result = build(demo_spec, demo_profile, art_library)
    assert result.report.warnings == []
    assert result.canvas.width == 2048
    assert len(result.report.placements) > 10


def test_albedo_and_spec_map_are_painted_by_the_same_geometry(demo_spec, demo_profile, art_library):
    """A matte rocker must be matte exactly where the rocker is."""
    result = build(demo_spec, demo_profile, art_library)
    matte = default_library().resolve("matte")
    zone = demo_profile.zone("rocker.left")
    x, y, w, h = zone.pixel_rect(result.canvas.size)
    px, py = int(x + w * 0.05), int(y + h * 0.5)
    spec_px = np.round(result.canvas.spec[py, px] * 255).astype(int)
    assert spec_px[1] == matte.roughness  # roughness channel
    assert spec_px[0] == matte.metallic


def test_glass_override_only_touches_the_spec_map(demo_spec, demo_profile, art_library):
    result = build(demo_spec, demo_profile, art_library)
    zone = demo_profile.zone("glass")
    x, y, w, h = zone.pixel_rect((2048, 2048))
    px, py = int(x + w / 2), int(y + h / 2)
    assert int(round(result.canvas.spec[py, px][3] * 255)) == 0  # unlit: spec mask off
    assert result.canvas.sample_albedo(px, py)[:3] != (0, 0, 0)  # colour untouched


def test_wheels_without_a_zone_become_a_manual_step(demo_spec, demo_profile, art_library):
    result = build(demo_spec, demo_profile, art_library)
    assert any("rim colour" in step for step in result.report.manual_steps)


def test_mirrored_island_flips_reading_matter(demo_profile):
    """The same logo on both rear quarters: the mirrored island gets flipped art
    so it reads correctly in the sim."""
    element = Element.parse(
        {"kind": "logo", "zones": ["rear_quarter"], "logo": "x", "size": {"h": 0.3}}, 0
    )
    left = place.resolve(element, demo_profile.zone("rear_quarter.left"), demo_profile, (2048, 2048), 4.0)
    right = place.resolve(element, demo_profile.zone("rear_quarter.right"), demo_profile, (2048, 2048), 4.0)
    assert left.mirrored is False
    assert right.mirrored is True

    art = Image.new("RGBA", (40, 10), (0, 0, 0, 0))
    art.putpixel((0, 0), (255, 0, 0, 255))  # a mark at the art's left edge
    assert place.orient(art, left).getpixel((0, 0))[0] == 255
    assert place.orient(art, right).getpixel((39, 0))[0] == 255


def test_shapes_mirror_but_lettering_does_not(demo_profile, art_library):
    """Two flanks, one spec: the band is mirror-symmetric, the logo is not flipped."""
    spec = LiverySpec.parse(
        {
            "car": "_demo_gt3",
            "number_mode": "sim_stamped",
            "base": {"color": "#111111"},
            "layers": [
                {"id": "b", "kind": "band", "zones": ["door"], "rect": [0.0, 0.3, 0.4, 0.2],
                 "color": "#ff0000"},
                {"id": "l", "kind": "logo", "zones": ["door"], "logo": "sample-primary",
                 "at": {"u": 0.2, "v": 0.7}, "size": {"h": 0.2}},
            ],
        }
    )
    result = Renderer(spec, demo_profile, art_library).render()
    by_zone = {p["zone"]: p for p in result.report.placements if p["layer"] == "b"}
    left_box, right_box = by_zone["door.left"]["box"], by_zone["door.right"]["box"]
    left_zone = demo_profile.zone("door.left").pixel_rect((2048, 2048))
    right_zone = demo_profile.zone("door.right").pixel_rect((2048, 2048))
    # Distance from the nose edge of each panel must match.
    from_nose_left = left_box[0] - left_zone[0]
    from_nose_right = (right_zone[0] + right_zone[2]) - (right_box[0] + right_box[2])
    assert abs(from_nose_left - from_nose_right) <= 1
    assert all(not p["mirrored"] for p in result.report.placements if p["layer"] == "l")


def test_low_contrast_number_is_reported(demo_profile, art_library):
    spec = LiverySpec.parse(
        {
            "car": "_demo_gt3",
            "base": {"color": "#101010"},
            "layers": [],
            "numbers": {"value": "8", "zones": ["door.left"], "color": "#151515"},
        }
    )
    result = Renderer(spec, demo_profile, art_library).render()
    assert any("spotter" in w for w in result.report.warnings)


def test_logo_too_small_is_reported(demo_profile, art_library):
    spec = LiverySpec.parse(
        {
            "car": "_demo_gt3",
            "number_mode": "sim_stamped",
            "base": {"color": "#ffffff"},
            "layers": [
                {"kind": "logo", "zones": ["door.left"], "logo": "sample-primary",
                 "size": {"height_mm": 20}},
            ],
        }
    )
    result = Renderer(spec, demo_profile, art_library).render()
    assert any("minimum" in w for w in result.report.warnings)


def test_overlapping_marks_are_reported(demo_profile, art_library):
    spec = LiverySpec.parse(
        {
            "car": "_demo_gt3",
            "number_mode": "sim_stamped",
            "base": {"color": "#ffffff"},
            "layers": [
                {"id": "a", "kind": "logo", "zones": ["door.left"], "logo": "sample-primary",
                 "at": {"u": 0.5, "v": 0.5}, "size": {"w": 0.6}},
                {"id": "b", "kind": "logo", "zones": ["door.left"], "logo": "sample-associate",
                 "at": {"u": 0.5, "v": 0.52}, "size": {"w": 0.6}},
            ],
        }
    )
    result = Renderer(spec, demo_profile, art_library).render()
    assert any("overlap" in w for w in result.report.warnings)


def test_metallic_albedo_is_lifted(demo_profile, art_library):
    spec = LiverySpec.parse(
        {
            "car": "_demo_gt3",
            "number_mode": "sim_stamped",
            "base": {"color": "#050505", "material": "chrome"},
            "layers": [],
        }
    )
    result = Renderer(spec, demo_profile, art_library).render()
    assert any("albedo lifted" in note for note in result.report.notes)
    assert result.canvas.sample_albedo(10, 10)[0] > 200


def test_mark_outside_its_zone_is_reported(demo_profile, art_library):
    spec = LiverySpec.parse(
        {
            "car": "_demo_gt3",
            "number_mode": "sim_stamped",
            "base": {"color": "#ffffff"},
            "layers": [
                {"kind": "fill", "zones": ["door.left"], "color": "#ff0000",
                 "rect": [1.6, 0.0, 0.3, 0.3]},
            ],
        }
    )
    result = Renderer(spec, demo_profile, art_library).render()
    assert any("painted nothing" in w or "clipped" in w for w in result.report.warnings)


def test_car_profile_mismatch_is_refused(demo_profile, art_library):
    spec = LiverySpec.parse({"car": "other_car", "layers": [], "number_mode": "sim_stamped"})
    with pytest.raises(Exception) as exc:
        Renderer(spec, demo_profile, art_library)
    assert "other_car" in str(exc.value)


def test_canvas_blend_modes():
    canvas = PaintCanvas.new(8, 8, (128, 128, 128, 255))
    art = Image.new("RGBA", (8, 8), (128, 128, 128, 255))
    canvas.stamp(art, (0, 0, 8, 8), blend="multiply")
    assert canvas.sample_albedo(4, 4)[0] == 64
