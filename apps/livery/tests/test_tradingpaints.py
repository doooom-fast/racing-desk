"""Trading Paints: reading the Downloader's options, and staging a build for the upload form."""

import json
import os
import shutil

import pytest
from PIL import Image

from livery import tradingpaints as tp
from livery.cli import main
from livery.config import Config
from livery.errors import LiveryError
from livery.tga import save_tga

CONFIG_XML = """<?xml version="1.0" encoding="utf-8"?>
<Settings>
  <Option><configname>Delete schemes once session ends</configname><configvalue>True</configvalue></Option>
  <Option><configname>Auto refresh textures</configname><configvalue>True</configvalue></Option>
  <Option><configname>Download my schemes</configname><configvalue>{own}</configvalue></Option>
  <Option><configname>Delete schemes before downloading</configname><configvalue>True</configvalue></Option>
  <Option><configname>Show Activity</configname><configvalue>False</configvalue></Option>
  <Option><configname>User ID</configname><configvalue>7654321</configvalue></Option>
  <Option><configname>Keep my paints synced from website</configname><configvalue>False</configvalue></Option>
</Settings>
"""


def _config_xml(tmp_path, own="True"):
    path = tmp_path / "config.xml"
    path.write_text(CONFIG_XML.format(own=own), encoding="utf-8")
    return path


def test_downloader_settings_read_the_options_and_nothing_else(tmp_path):
    settings = tp.downloader_settings(_config_xml(tmp_path))
    assert settings.updates_own_paints is True
    assert settings.deletes_before_download is True
    assert settings.deletes_after_session is True
    assert settings.keeps_synced is False
    # The account id sits in the same file; it never leaves it.
    assert "7654321" not in repr(settings)


def test_no_downloader_means_nothing_to_warn_about(tmp_path):
    assert tp.downloader_settings(tmp_path / "nope.xml") is None
    assert tp.session_warning(None) is None


def test_session_warning_only_when_the_downloader_updates_own_paints(tmp_path):
    on = tp.downloader_settings(_config_xml(tmp_path, "True"))
    off = tp.downloader_settings(_config_xml(tmp_path, "False"))
    assert "livery tp liveries/x.yaml" in tp.session_warning(on, "liveries/x.yaml")
    assert tp.session_warning(off) is None


def _built(tmp_path, spec, size=(1024, 1024)):
    config = Config(root=tmp_path, build_dir=tmp_path / "build", iracing_paint_dir=tmp_path / "paint")
    build = config.build_dir / spec.car / spec.slug
    save_tga(Image.new("RGB", size, (200, 30, 30)), build / "car_num_42.tga")
    save_tga(Image.new("RGBA", size, (0, 0, 0, 128)), build / "car_spec_42.tga", bits=32)
    return config, build


def test_staging_takes_the_paint_from_the_build_and_the_mip_from_the_sim(tmp_path, demo_spec):
    config, build = _built(tmp_path, demo_spec)

    # Built but not installed: the paint stages, the spec map can't.
    package = tp.stage_for_upload(demo_spec, config, "42")
    assert package.paint.name == "car_num_42.tga" and package.paint.exists()
    assert package.spec_mip is None
    assert not package.ready and "livery install" in package.problems[0]

    # Installed, but the sim hasn't loaded the car, so there is no .mip yet.
    paint_dir = config.paint_dir(demo_spec.car)
    paint_dir.mkdir(parents=True)
    shutil.copy2(build / "car_spec_42.tga", paint_dir / "car_spec_42.tga")
    package = tp.stage_for_upload(demo_spec, config, "42")
    assert "load the car" in package.problems[0]

    # The sim wrote the .mip after the install: everything the form takes is there.
    mip = paint_dir / "car_spec_42.mip"
    mip.write_bytes(b"mip")
    stamp = (paint_dir / "car_spec_42.tga").stat().st_mtime + 60
    os.utime(mip, (stamp, stamp))
    package = tp.stage_for_upload(demo_spec, config, "42")
    assert package.ready and package.spec_mip.read_bytes() == b"mip"
    upload = json.loads((package.folder / "upload.json").read_text())
    assert upload["number_type"] == "Custom Number" and upload["pro_required"] is True
    assert upload["url"] == tp.UPLOAD_URL
    assert "Trading Paints Pro" in "\n".join(package.instructions())


def test_a_mip_from_an_older_install_does_not_count(tmp_path, demo_spec):
    config, build = _built(tmp_path, demo_spec)
    paint_dir = config.paint_dir(demo_spec.car)
    paint_dir.mkdir(parents=True)
    installed = paint_dir / "car_spec_42.tga"
    shutil.copy2(build / "car_spec_42.tga", installed)
    mip = paint_dir / "car_spec_42.mip"
    mip.write_bytes(b"old")
    stamp = installed.stat().st_mtime - 60
    os.utime(mip, (stamp, stamp))
    package = tp.stage_for_upload(demo_spec, config, "42")
    assert package.spec_mip is None and "load the car" in package.problems[0]


def test_an_installed_spec_map_from_another_build_does_not_count(tmp_path, demo_spec):
    config, build = _built(tmp_path, demo_spec)
    paint_dir = config.paint_dir(demo_spec.car)
    paint_dir.mkdir(parents=True)
    save_tga(Image.new("RGBA", (1024, 1024), (9, 9, 9, 9)), paint_dir / "car_spec_42.tga", bits=32)
    (paint_dir / "car_spec_42.mip").write_bytes(b"theirs")
    package = tp.stage_for_upload(demo_spec, config, "42")
    assert "not this build's" in package.problems[0]


def test_only_the_two_sizes_trading_paints_takes_are_accepted(tmp_path, demo_spec):
    config, _ = _built(tmp_path, demo_spec, size=(512, 512))
    with pytest.raises(LiveryError, match="1024"):
        tp.stage_for_upload(demo_spec, config, "42")


def test_cli_tp_stages_and_says_what_is_still_missing(tmp_path, repo_root, monkeypatch, capsys):
    monkeypatch.setenv("LIVERY_BUILD_DIR", str(tmp_path / "build"))
    monkeypatch.setenv("LIVERY_IRACING_PAINT_DIR", str(tmp_path / "paint"))
    demo = str(repo_root / "liveries" / "demo-night-runner.yaml")
    assert main(["--root", str(repo_root), "build", demo, "--customer-id", "42"]) == 0
    code = main(["--root", str(repo_root), "tp", demo, "--customer-id", "42", "--no-open"])
    out = capsys.readouterr().out
    assert code == 1
    assert "car_num_42.tga" in out and "Custom Number" in out
    assert "! the installed spec map is not this build's" in out
    assert list((tmp_path / "build" / "_demo_gt3").glob("*/tradingpaints/upload.json"))


def test_doctor_reads_the_downloader_without_the_account_id(tmp_path):
    from livery import doctor

    check = doctor._tradingpaints(_config_xml(tmp_path))
    assert check.status == doctor.WARN and "deletes the local files first" in check.detail
    assert "7654321" not in check.line()
    assert doctor._tradingpaints(_config_xml(tmp_path, "False")).status == doctor.OK
    assert doctor._tradingpaints(tmp_path / "absent.xml").status == doctor.OK
