"""Files on disk: TGA shape, mip busting, install behaviour, CLI wiring."""

import json

from PIL import Image

from livery.cli import main
from livery.config import Config
from livery.tga import bust_mip, describe, save_tga


def test_tga_is_written_24_bit_rle(tmp_path):
    path = save_tga(Image.new("RGBA", (32, 32), (10, 20, 30, 255)), tmp_path / "car_1.tga")
    info = describe(path)
    assert info["bits"] == 24
    assert info["compression"] == "tga_rle"


def test_spec_map_keeps_its_alpha(tmp_path):
    path = save_tga(Image.new("RGBA", (32, 32), (1, 2, 3, 128)), tmp_path / "car_spec_1.tga", bits=32)
    assert describe(path)["bits"] == 32
    assert Image.open(path).convert("RGBA").getpixel((0, 0))[3] == 128


def test_mip_is_removed_so_the_sim_rereads_the_tga(tmp_path):
    tga = save_tga(Image.new("RGBA", (8, 8)), tmp_path / "car_2.tga")
    mip = tga.with_suffix(".mip")
    mip.write_bytes(b"stale")
    assert bust_mip(tga) == [mip]
    assert not mip.exists()


def test_filenames_follow_the_number_mode():
    config = Config()
    assert config.albedo_name("custom", "42") == "car_num_42.tga"
    assert config.albedo_name("sim_stamped", "42") == "car_42.tga"
    assert config.spec_name("42") == "car_spec_42.tga"


def test_cli_build_writes_paint_and_report(tmp_path, repo_root, capsys):
    out = tmp_path / "out"
    code = main([
        "--root", str(repo_root),
        "build", str(repo_root / "liveries" / "demo-night-runner.yaml"),
        "--customer-id", "424242", "--out", str(out),
    ])
    assert code == 0
    assert (out / "car_num_424242.tga").exists()
    assert (out / "car_spec_424242.tga").exists()
    report = json.loads((out / "build-report.json").read_text())
    assert report["car"] == "_demo_gt3"
    assert report["number_mode"] == "custom"
    assert report["spec_digest"]


def test_cli_install_dry_run_touches_nothing(tmp_path, repo_root, monkeypatch, capsys):
    paint = tmp_path / "paint"
    (paint / "_demo_gt3").mkdir(parents=True)
    monkeypatch.setenv("LIVERY_IRACING_PAINT_DIR", str(paint))
    monkeypatch.setenv("LIVERY_CUSTOMER_ID", "1234")
    code = main([
        "--root", str(repo_root),
        "install", str(repo_root / "liveries" / "demo-night-runner.yaml"), "--dry-run",
    ])
    assert code == 0
    assert list((paint / "_demo_gt3").iterdir()) == []
    assert "would copy" in capsys.readouterr().out


def test_cli_doctor_reports_without_failing(repo_root, capsys):
    assert main(["--root", str(repo_root), "doctor", "_demo_gt3"]) == 0
    assert "profile _demo_gt3" in capsys.readouterr().out


def test_cli_reports_a_bad_spec_clearly(tmp_path, repo_root, capsys):
    bad = tmp_path / "bad.yaml"
    bad.write_text("version: 1\ncar: _demo_gt3\nlayers:\n  - kind: nonsense\n    zones: [door]\n")
    assert main(["--root", str(repo_root), "build", str(bad), "--customer-id", "1"]) == 1
    assert "kind must be one of" in capsys.readouterr().err
