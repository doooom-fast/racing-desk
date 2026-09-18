"""Deriving profiles: from a 3D bake (measured) and from a template PSD (guessed)."""

import pytest

import synth_bake
from livery.bake import AxisConvention, analyze_region, load_bake, profile_from_bake
from livery.errors import LiveryError
from livery.templates import bootstrap_blank, classify_layer, zones_from_layers


@pytest.fixture(scope="module")
def maps(tmp_path_factory):
    return load_bake(synth_bake.write(tmp_path_factory.mktemp("bake")))


def test_bake_recovers_declared_axes(maps):
    left = analyze_region(maps, (0, 0, 0.5, 0.25))
    assert (left.plane, left.side) == ("side", "left")
    assert left.axes == {"tail": "+x", "down": "+y"}

    right = analyze_region(maps, (0, 0.5, 0.5, 0.25))
    assert (right.plane, right.side) == ("side", "right")
    assert right.axes == {"tail": "-x", "down": "+y"}

    hood = analyze_region(maps, (300 / 512, 0, 160 / 512, 160 / 512))
    assert (hood.plane, hood.side) == ("top", "center")
    assert hood.axes == {"tail": "+y", "car_right": "+x"}


def test_bake_measures_scale(maps):
    """The synthetic panels were built at 5mm per pixel."""
    left = analyze_region(maps, (0, 0, 0.5, 0.25))
    assert left.px_per_meter == pytest.approx(200, rel=0.02)


def test_profile_from_bake_is_usable(maps):
    profile = profile_from_bake("_synth", maps)
    assert set(profile.zones) == {"door.left", "door.right", "hood"}
    assert profile.confidence == "checked"
    for zone in profile.zones.values():
        zone.frame  # every derived zone must describe a real panel
    assert profile.mirror_pairs() == [("door.left", "door.right")]


def test_bake_region_off_the_mesh_explains_itself(maps):
    with pytest.raises(LiveryError) as exc:
        analyze_region(maps, (0.85, 0.85, 0.1, 0.1))
    assert "UVs" in str(exc.value)


def test_axis_convention_handles_a_differently_oriented_model():
    convention = AxisConvention(forward="+x", up="+z")
    import numpy as np

    car = convention.to_car(np.array([[1.0, 0.0, 0.0]], dtype=np.float32))
    assert car[0][0] == pytest.approx(1.0)  # world +x is forward


def test_layer_classification():
    assert classify_layer("Door RH") == ("door", "side", "right")
    assert classify_layer("Left Front Fender") == ("front_fender", "side", "left")
    assert classify_layer("HOOD") == ("hood", "top", "center")
    assert classify_layer("Colour Swatches") is None


def test_layers_merge_into_one_zone_per_panel():
    zones = zones_from_layers(
        [("Door LH", (100, 100, 400, 300)), ("Door LH shadow", (90, 110, 420, 320))],
        (1000, 1000),
    )
    assert set(zones) == {"door.left"}
    assert zones["door.left"].rect == (0.09, 0.1, 0.33, 0.22)


def test_blank_profile_is_valid_and_honest():
    profile = bootstrap_blank("newcar", 1024, 1024)
    profile.validate()
    assert profile.confidence == "draft"
    assert "body" in profile.zones
