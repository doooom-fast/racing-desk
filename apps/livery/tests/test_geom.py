"""The mirroring rules. If these break, cars get backwards lettering."""

import pytest

from livery.errors import ProfileError
from livery.geom import map_rect, panel_frame

LEFT = {"tail": "+x", "down": "+y"}
RIGHT_SEPARATE = {"tail": "-x", "down": "+y"}
RIGHT_SHARED = {"tail": "+x", "down": "+y"}


def test_separate_islands_are_not_mirrored():
    assert panel_frame("side", "left", LEFT).mirrored is False
    assert panel_frame("side", "right", RIGHT_SEPARATE).mirrored is False


def test_shared_island_on_the_right_flank_is_mirrored():
    """Same UV direction on both flanks means the right one is a mirror image,
    so art has to be flipped before it is stamped."""
    assert panel_frame("side", "right", RIGHT_SHARED).mirrored is True


def test_same_author_rect_lands_symmetrically_on_both_flanks():
    left = panel_frame("side", "left", LEFT)
    right = panel_frame("side", "right", RIGHT_SEPARATE)
    zone = (0.0, 0.0, 1000.0, 200.0)
    # A mark 10% back from the nose, 30% long.
    lx, _, lw, _ = map_rect(zone, left, 0.1, 0.0, 0.3, 1.0)
    rx, _, rw, _ = map_rect(zone, right, 0.1, 0.0, 0.3, 1.0)
    assert (lx, lw) == (100, 300)
    # The right flank runs the other way, so the same car position is mirrored
    # across the zone: 1 - (0.1 + 0.3) = 0.6.
    assert (rx, rw) == (600, 300)


def test_horizontal_panel_axes():
    hood = panel_frame("top", "center", {"tail": "+y", "car_right": "+x"})
    assert hood.u == (0, 1) and hood.v == (1, 0)
    assert hood.camera_right == (1, 0) and hood.mirrored is False
    # Nose-ward half of the hood, left half across the car.
    assert map_rect((0, 0, 800, 600), hood, 0.0, 0.0, 0.5, 0.5) == (0, 0, 400, 300)


def test_front_panel_reads_toward_the_cars_left():
    """Standing in front of a car, the viewer's right is the car's left."""
    front = panel_frame("front", "center", {"car_right": "-x", "down": "+y"})
    assert front.camera_right == (1, 0)
    assert front.mirrored is False


def test_missing_axis_is_an_error_naming_what_to_declare():
    with pytest.raises(ProfileError) as exc:
        panel_frame("side", "left", {"tail": "+x"})
    assert "down" in str(exc.value)


def test_non_perpendicular_axes_rejected():
    with pytest.raises(ProfileError):
        panel_frame("top", "center", {"tail": "+x", "car_right": "-x"})
