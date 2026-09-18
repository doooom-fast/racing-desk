"""Spec grammar and profile selection — the surface an agent authors against."""

import pytest

from livery.errors import LiveryError, ProfileError
from livery.profile import CarProfile
from livery.spec import LiverySpec

MINIMAL = {
    "car": "demo",
    "layers": [{"kind": "band", "zones": ["door"], "color": "#fff", "rect": [0, 0, 1, 1]}],
}


def test_unknown_key_error_lists_valid_keys():
    bad = {"car": "demo", "layers": [{"kind": "band", "zones": ["d"], "colour": "#fff"}]}
    with pytest.raises(LiveryError) as exc:
        LiverySpec.parse(bad)
    assert "colour" in str(exc.value) and "color" in str(exc.value)


def test_sponsors_are_logo_layers():
    spec = LiverySpec.parse({**MINIMAL, "sponsors": [{"logo": "acme", "zones": ["door"]}]})
    kinds = [layer.kind for layer in spec.layers]
    assert kinds == ["band", "logo"]


def test_orient_defaults_split_shapes_from_reading_matter():
    spec = LiverySpec.parse(
        {**MINIMAL, "sponsors": [{"logo": "acme", "zones": ["door"]}]}
    )
    assert spec.layers[0].effective_orient == "car"      # a band mirrors with the car
    assert spec.layers[1].effective_orient == "reading"  # a logo stays readable


def test_sim_stamped_with_painted_numbers_is_rejected():
    with pytest.raises(LiveryError) as exc:
        LiverySpec.parse(
            {**MINIMAL, "number_mode": "sim_stamped",
             "numbers": {"value": "7", "zones": ["door"]}}
        )
    assert "sim_stamped" in str(exc.value)


def test_duplicate_layer_ids_rejected():
    with pytest.raises(LiveryError):
        LiverySpec.parse(
            {"car": "demo", "layers": [
                {"id": "a", "kind": "fill", "zones": ["door"], "color": "#fff"},
                {"id": "a", "kind": "fill", "zones": ["hood"], "color": "#000"},
            ]}
        )


def test_size_rejects_double_specified_dimension():
    with pytest.raises(LiveryError):
        LiverySpec.parse(
            {"car": "demo", "layers": [
                {"kind": "logo", "zones": ["door"], "logo": "x",
                 "size": {"h": 0.5, "height_mm": 120}},
            ]}
        )


def test_zone_selectors(demo_profile):
    assert [z.name for z in demo_profile.select(["door"])] == ["door.left", "door.right"]
    assert [z.name for z in demo_profile.select(["door"], "left")] == ["door.left"]
    assert {z.name for z in demo_profile.select(["@horizontal"])} == {"hood", "roof", "decklid"}
    # A glob matches zone names, so rear_* takes the quarters and the wing but
    # not the rear bumper panel, which is just "rear".
    assert {z.name for z in demo_profile.select(["rear_*"])} == {
        "rear_quarter.left", "rear_quarter.right", "rear_wing"
    }


def test_unknown_selector_names_the_alternatives(demo_profile):
    with pytest.raises(ProfileError) as exc:
        demo_profile.select(["bonnet"])
    assert "hood" in str(exc.value)


def test_profile_rejects_rect_outside_canvas():
    with pytest.raises(ProfileError):
        CarProfile.from_dict(
            {"car": "x", "zones": {"a": {"rect": [0.5, 0, 0.8, 0.2],
                                          "axes": {"tail": "+x", "down": "+y"}}}}
        )


def test_demo_profile_round_trips(demo_profile, tmp_path):
    out = demo_profile.save(tmp_path / "rt.yaml")
    again = CarProfile.load(out)
    assert again.zones.keys() == demo_profile.zones.keys()
    assert again.canvas == demo_profile.canvas
