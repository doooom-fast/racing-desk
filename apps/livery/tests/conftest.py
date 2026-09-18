import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))


@pytest.fixture
def repo_root() -> Path:
    return ROOT


@pytest.fixture
def demo_profile():
    from livery.profile import CarProfile

    return CarProfile.load(ROOT / "profiles" / "_demo_gt3.yaml")


@pytest.fixture
def demo_spec():
    from livery.spec import LiverySpec

    return LiverySpec.load(ROOT / "liveries" / "demo-night-runner.yaml")


@pytest.fixture
def art_library():
    from livery.art import ArtLibrary

    return ArtLibrary(ROOT / "art")
