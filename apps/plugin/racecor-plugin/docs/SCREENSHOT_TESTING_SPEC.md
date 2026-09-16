# Screenshot Testing Tool — Specification

This document specs out an automated visual regression testing tool for the RaceCorProDrive SimHub dashboard. The tool captures screenshots of the dashboard at specific moments during a demo sequence and compares them against golden reference images to detect visual regressions.

## Problem

The existing test suites validate trigger logic, dataset integrity, and Homebridge color mapping, but none of them verify what the user actually sees. The dashboard renders inside SimHub's WPF-based engine, which means visual issues (colors not appearing, text overflow, countdown timer bugs, layout problems) can only be caught by looking at the rendered output. This tool automates that.

## Requirements

**Hard requirements:**
- Windows only (SimHub is Windows-only)
- SimHub installed with the RaceCorProDrive plugin and dashboard template
- No live sim session needed (uses demo mode)
- Produces a pass/fail result with diff images on failure
- Runs unattended after initial golden image generation

**Nice to have:**
- Headless execution (no monitor required)
- Integration with CI (GitHub Actions Windows runner)
- Configurable similarity threshold (account for font rendering differences across machines)

## Architecture

```
tools/screenshot_test.py
  → Starts SimHub in demo mode via subprocess
  → Waits for dashboard window to appear
  → Steps through demo sequence (each step has a known visual state)
  → Captures screenshot of the dashboard window at each step
  → Compares against golden images in tests/golden/
  → Produces report with pass/fail per step and diff images
```

### Key Components

**`tools/screenshot_test.py`** — Main test runner. Python script using `pyautogui` or `pywin32` for window capture.

**`tests/golden/`** — Reference screenshots. Generated once on a known-good build, committed to the repo. Each file is named by demo step: `step_01_race_start.png`, `step_02_spin_catch.png`, etc.

**`tests/screenshot_results/`** — Output directory (gitignored). Contains captured screenshots, diff images, and a JSON report.

### Window Capture

SimHub dashboards render in a dedicated WPF window. The tool needs to:

1. Find the SimHub dashboard window by title (the dashboard name is "k10 motorsports")
2. Capture just that window, not the full screen
3. Handle DPI scaling (SimHub dashboards can render at non-100% scale)

Two approaches:

**Option A: `pywin32` + `PrintWindow`**
```python
import win32gui
import win32ui
import win32con

def capture_window(window_title):
    hwnd = win32gui.FindWindow(None, window_title)
    rect = win32gui.GetWindowRect(hwnd)
    width = rect[2] - rect[0]
    height = rect[3] - rect[1]

    hwnd_dc = win32gui.GetWindowDC(hwnd)
    mfc_dc = win32ui.CreateDCFromHandle(hwnd_dc)
    save_dc = mfc_dc.CreateCompatibleDC()

    bitmap = win32ui.CreateBitmap()
    bitmap.CreateCompatibleBitmap(mfc_dc, width, height)
    save_dc.SelectObject(bitmap)

    # PW_RENDERFULLCONTENT captures even if window is occluded
    result = ctypes.windll.user32.PrintWindow(hwnd, save_dc.GetSafeHdc(), 3)

    bitmap.SaveBitmapFile(save_dc, output_path)
    # cleanup...
```

**Option B: `mss` (cross-platform screen capture)**
```python
import mss
# Faster but requires window to be visible and unoccluded
```

Option A is preferred because `PrintWindow` with `PW_RENDERFULLCONTENT` captures the window even if it's behind other windows or partially off-screen.

### Demo Mode Integration

The plugin's demo mode (`DemoSequence.cs`) fires a curated sequence of events with known severities, categories, and colors. The screenshot tool needs to synchronize with these steps.

**Approach: Property polling.** The tool reads SimHub's HTTP API during demo mode to know when a new step has fired:

```python
import requests
import time

SIMHUB_URL = "http://localhost:8888/api/pluginproperty"

def wait_for_step(expected_title, timeout=10):
    """Poll until the dashboard shows the expected topic title."""
    start = time.time()
    while time.time() - start < timeout:
        title = requests.get(f"{SIMHUB_URL}/RaceCorProDrive.Plugin.CommentaryTitle").text.strip('"')
        if title == expected_title:
            time.sleep(0.3)  # let the dashboard render
            return True
        time.sleep(0.1)
    return False
```

The demo sequence is deterministic — each step fires a known topic with a known severity. The tool has a manifest of expected steps:

```python
DEMO_STEPS = [
    {"step": 1, "title": "Race Start", "severity": 4, "category": "racing_experience"},
    {"step": 2, "title": "Big Save", "severity": 5, "category": "car_response"},
    {"step": 3, "title": "Position Lost", "severity": 4, "category": "racing_experience"},
    # ... one entry per demo step
]
```

### Image Comparison

Two levels of comparison:

**Pixel-level diff (strict):** Direct pixel comparison with a configurable tolerance. Uses Pillow:

```python
from PIL import Image, ImageChops
import numpy as np

def compare_images(golden_path, captured_path, threshold=0.02):
    golden = np.array(Image.open(golden_path))
    captured = np.array(Image.open(captured_path))

    if golden.shape != captured.shape:
        return False, None, "Size mismatch"

    diff = np.abs(golden.astype(int) - captured.astype(int))
    diff_ratio = np.count_nonzero(diff > 10) / diff.size

    # Generate visual diff image
    diff_image = Image.fromarray(np.clip(diff * 5, 0, 255).astype(np.uint8))

    return diff_ratio < threshold, diff_image, f"{diff_ratio:.4%} pixels differ"
```

**Perceptual hash (loose):** For CI environments where font rendering may differ. Uses `imagehash`:

```python
import imagehash

def perceptual_compare(golden_path, captured_path, max_distance=8):
    golden_hash = imagehash.phash(Image.open(golden_path))
    captured_hash = imagehash.phash(Image.open(captured_path))
    distance = golden_hash - captured_hash
    return distance <= max_distance, distance
```

The tool runs pixel-level first. If it fails but perceptual passes, the report marks it as "visually similar but pixel-different" (likely a rendering environment difference, not a real regression).

### What Gets Validated Per Step

For each demo step, the tool checks:

1. **Text is visible** — The prompt text area is not empty (compare against a known-empty baseline)
2. **Color is correct** — Sample the sentiment color region and compare against the expected color for this step's category + severity
3. **Layout is intact** — Overall image matches the golden reference within threshold
4. **Text doesn't overflow** — The text stays within the expected bounding box (compare text region dimensions)

Color sampling is useful because it catches the specific bug from alpha testing where sentiment colors weren't appearing in the dashboard.

## Output

### Report Format

```json
{
  "timestamp": "2026-03-11T15:30:00",
  "simhub_version": "9.5.2",
  "dashboard": "k10 motorsports",
  "steps": [
    {
      "step": 1,
      "title": "Race Start",
      "result": "pass",
      "pixel_diff": "0.12%",
      "perceptual_distance": 2,
      "captured": "tests/screenshot_results/step_01_captured.png",
      "diff": null
    },
    {
      "step": 3,
      "title": "Position Lost",
      "result": "fail",
      "pixel_diff": "8.34%",
      "perceptual_distance": 14,
      "captured": "tests/screenshot_results/step_03_captured.png",
      "diff": "tests/screenshot_results/step_03_diff.png"
    }
  ],
  "summary": {
    "total": 8,
    "passed": 7,
    "failed": 1
  }
}
```

### Diff Images

On failure, the tool writes a side-by-side diff image:
- Left: golden reference
- Center: captured screenshot
- Right: pixel diff (amplified 5x for visibility)

## Usage

### Generate golden images (first time or after intentional visual changes)

```bash
python tools/screenshot_test.py --generate-golden
```

This runs the full demo sequence, captures each step, and saves to `tests/golden/`. Review the images manually to confirm they look correct before committing.

### Run visual regression test

```bash
python tools/screenshot_test.py
```

Outputs a pass/fail summary to stdout and writes the full report to `tests/screenshot_results/report.json`.

### Options

```
--simhub-path PATH      SimHub installation directory (auto-detected if not set)
--threshold FLOAT        Pixel diff threshold (default: 0.02 = 2%)
--perceptual-max INT     Max perceptual hash distance (default: 8)
--timeout INT            Seconds to wait for each demo step (default: 10)
--generate-golden        Generate new golden reference images
--keep-captures          Don't delete captured images on pass (for debugging)
```

## Dependencies

```
pip install pywin32 Pillow numpy imagehash requests
```

All Windows-only except `requests` and `Pillow`. The tool itself is Windows-only by design.

## Integration with Existing Tests

This is a separate layer from the four existing test suites. It requires a real SimHub installation and renders actual dashboard output. The existing tests cover logic correctness; this covers visual correctness.

Suggested CI integration (GitHub Actions Windows runner):

```yaml
- name: Screenshot regression test
  if: runner.os == 'Windows'
  run: |
    pip install pywin32 Pillow numpy imagehash requests
    python tools/screenshot_test.py --threshold 0.05
```

The threshold may need to be looser on CI (0.05 vs 0.02) to account for rendering differences across Windows versions and DPI settings. The perceptual hash comparison handles most of this, but pixel-level comparison is still valuable for catching color bugs.

## Limitations

- Requires SimHub installed (cannot run in a minimal CI container)
- Dashboard window must exist — SimHub needs to load the "k10 motorsports" dashboard template
- Font rendering may differ across Windows versions (the golden images are tied to the machine that generated them)
- DPI scaling differences between machines can cause false positives (mitigated by perceptual hash fallback)
- The demo sequence timing is not perfectly deterministic (the 0.3s render delay may need tuning per machine)

## Files

```
tools/screenshot_test.py           Main test runner (to be built)
tests/golden/                      Golden reference images (generated, committed)
tests/screenshot_results/          Captured images and report (gitignored)
```
