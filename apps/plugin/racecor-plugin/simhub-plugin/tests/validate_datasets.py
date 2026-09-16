#!/usr/bin/env python3
"""
Dataset validation tests for Media Broadcaster plugin.

Validates structural integrity, cross-references, and known regression points
across commentary_topics.json, commentary_fragments.json, and sentiments.json.

Run: python3 tests/validate_datasets.py
"""

import json
import os
import sys
import colorsys
import unittest
from pathlib import Path

DATASET_DIR = Path(__file__).resolve().parent.parent / "racecorprodrive-data"
TOPICS_PATH = DATASET_DIR / "commentary_topics.json"
FRAGMENTS_PATH = DATASET_DIR / "commentary_fragments.json"
SENTIMENTS_PATH = DATASET_DIR / "sentiments.json"

VALID_CATEGORIES = {"hardware", "game_feel", "car_response", "racing_experience"}

VALID_CONDITIONS = {
    ">", "<", "==", "change", "increase", "decrease", "spike", "sudden_drop",
    "extreme", "rapid_change", "sustained", "personal_best",
    "player_gain_position", "player_lost_position", "player_entering",
    "off_track", "yellow_flag", "black_flag", "race_start", "close_proximity",
}

# Flag hue ranges to avoid (±15° around each flag color)
FLAG_HUES = {
    "red": 0,
    "yellow": 60,
    "blue": 240,
    "orange": 30,
}
FLAG_HUE_TOLERANCE = 15  # degrees


def load_json(path):
    with open(path, "r") as f:
        return json.load(f)


def hex_to_hue(hex_color: str) -> float:
    """Convert #RRGGBB or #AARRGGBB to hue in degrees (0-360)."""
    h = hex_color.lstrip("#")
    if len(h) == 8:
        h = h[2:]  # strip alpha
    r, g, b = int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255
    hue, _, _ = colorsys.rgb_to_hsv(r, g, b)
    return hue * 360


def hue_collides_with_flag(hue: float) -> str | None:
    """Returns the flag name if the hue is too close to a flag color, else None."""
    for flag_name, flag_hue in FLAG_HUES.items():
        delta = abs(hue - flag_hue)
        delta = min(delta, 360 - delta)  # wraparound
        if delta < FLAG_HUE_TOLERANCE:
            return flag_name
    return None


class TestTopicsDataset(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = load_json(TOPICS_PATH)
        cls.topics = cls.data.get("topics", [])

    def test_file_loads(self):
        self.assertIn("topics", self.data)
        self.assertGreater(len(self.topics), 0, "No topics found")

    def test_has_version(self):
        self.assertIn("version", self.data)

    def test_all_topics_have_required_fields(self):
        for topic in self.topics:
            with self.subTest(topic_id=topic.get("id", "MISSING")):
                self.assertTrue(topic.get("id"), "Missing id")
                self.assertTrue(topic.get("category"), "Missing category")
                self.assertTrue(topic.get("title"), "Missing title")

    def test_categories_are_valid(self):
        for topic in self.topics:
            with self.subTest(topic_id=topic["id"]):
                self.assertIn(
                    topic["category"],
                    VALID_CATEGORIES,
                    f"Invalid category '{topic['category']}' for topic '{topic['id']}'",
                )

    def test_severity_in_range(self):
        for topic in self.topics:
            with self.subTest(topic_id=topic["id"]):
                sev = topic.get("severity", 0)
                self.assertGreaterEqual(sev, 1, f"Severity too low for {topic['id']}")
                self.assertLessEqual(sev, 5, f"Severity too high for {topic['id']}")

    def test_at_least_one_trigger_per_topic(self):
        for topic in self.topics:
            with self.subTest(topic_id=topic["id"]):
                triggers = topic.get("triggers", [])
                self.assertGreater(
                    len(triggers), 0,
                    f"Topic '{topic['id']}' has no triggers",
                )

    def test_trigger_conditions_are_valid(self):
        for topic in self.topics:
            for i, trigger in enumerate(topic.get("triggers", [])):
                with self.subTest(topic_id=topic["id"], trigger_index=i):
                    cond = trigger.get("condition", "")
                    self.assertIn(
                        cond, VALID_CONDITIONS,
                        f"Invalid condition '{cond}' in topic '{topic['id']}'",
                    )

    def test_cooldown_is_positive(self):
        for topic in self.topics:
            with self.subTest(topic_id=topic["id"]):
                cd = topic.get("cooldownMinutes", 0)
                self.assertGreater(cd, 0, f"Non-positive cooldown for {topic['id']}")

    # ── Regression tests ────────────────────────────────────────────────

    def test_tyre_wear_uses_less_than_not_greater(self):
        """Regression: TyreWear is remaining life (1.0=new). Must use '<' to detect worn."""
        tyre_topics = [
            t for t in self.topics
            if any("tyrewear" in tr.get("dataPoint", "").lower()
                   for tr in t.get("triggers", []))
        ]
        self.assertGreater(len(tyre_topics), 0, "No tyre wear topics found")
        for topic in tyre_topics:
            for trigger in topic["triggers"]:
                if "tyrewear" in trigger.get("dataPoint", "").lower():
                    with self.subTest(topic_id=topic["id"], dp=trigger["dataPoint"]):
                        self.assertEqual(
                            trigger["condition"], "<",
                            f"Tyre wear trigger must use '<' (remaining life), "
                            f"found '{trigger['condition']}' in {topic['id']}",
                        )

    def test_tyre_temp_threshold_is_fahrenheit(self):
        """Regression: Tyre temps come through in °F. Threshold must be >= 200."""
        temp_topics = [
            t for t in self.topics
            if any("tyretemp" in tr.get("dataPoint", "").lower()
                   for tr in t.get("triggers", []))
        ]
        for topic in temp_topics:
            for trigger in topic["triggers"]:
                dp = trigger.get("dataPoint", "").lower()
                if "tyretemp" in dp and trigger.get("value") is not None:
                    with self.subTest(topic_id=topic["id"], dp=trigger["dataPoint"]):
                        self.assertGreaterEqual(
                            trigger["value"], 200,
                            f"Tyre temp threshold {trigger['value']} looks like Celsius, "
                            f"should be Fahrenheit (>= 200°F)",
                        )

    def test_kerb_hit_threshold_raised(self):
        """Regression: kerb_hit thresholdDelta was 7.0, should be 10.0+."""
        topic = next((t for t in self.topics if t["id"] == "kerb_hit"), None)
        if topic:
            for trigger in topic["triggers"]:
                if trigger.get("thresholdDelta") is not None:
                    self.assertGreaterEqual(trigger["thresholdDelta"], 10.0)

    def test_heavy_braking_threshold_raised(self):
        """Regression: heavy_braking value was -32, should be -38 or lower."""
        topic = next((t for t in self.topics if t["id"] == "heavy_braking"), None)
        if topic:
            for trigger in topic["triggers"]:
                if trigger.get("value") is not None and trigger["condition"] == "<":
                    self.assertLessEqual(trigger["value"], -38.0)

    def test_spin_catch_abs_value_raised(self):
        """Regression: spin_catch absValue was 2.5, should be 3.0+."""
        topic = next((t for t in self.topics if t["id"] == "spin_catch"), None)
        if topic:
            for trigger in topic["triggers"]:
                if trigger.get("absValue") is not None:
                    self.assertGreaterEqual(trigger["absValue"], 3.0)

    def test_close_proximity_threshold_tightened(self):
        """Regression: proximity was 0.01, should be 0.008 or tighter."""
        prox_topics = [
            t for t in self.topics
            if any(tr.get("condition") == "close_proximity"
                   for tr in t.get("triggers", []))
        ]
        for topic in prox_topics:
            for trigger in topic["triggers"]:
                if trigger.get("proximityThreshold") is not None:
                    with self.subTest(topic_id=topic["id"]):
                        self.assertLessEqual(trigger["proximityThreshold"], 0.008)


class TestFragmentsDataset(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.topics_data = load_json(TOPICS_PATH)
        cls.fragments_data = load_json(FRAGMENTS_PATH)
        cls.topic_ids = {t["id"] for t in cls.topics_data.get("topics", [])}
        cls.fragment_map = {
            f["topicId"]: f["fragments"]
            for f in cls.fragments_data.get("fragments", [])
        }

    def test_file_loads(self):
        self.assertIn("fragments", self.fragments_data)
        self.assertGreater(len(self.fragment_map), 0)

    def test_every_topic_has_fragments(self):
        """Every topic that doesn't use commentaryPrompts should have fragments."""
        # Topics with commentaryPrompts use LLM-generated commentary instead of fragments
        prompt_topics = {
            t["id"] for t in self.topics_data.get("topics", [])
            if "commentaryPrompts" in t
        }
        fragment_required = self.topic_ids - prompt_topics
        missing = fragment_required - set(self.fragment_map.keys())
        self.assertEqual(
            missing, set(),
            f"Topics missing from fragments (excluding commentaryPrompts topics): {missing}",
        )

    def test_no_orphan_fragments(self):
        """No fragment entries for topics that don't exist in topics file."""
        orphans = set(self.fragment_map.keys()) - self.topic_ids
        self.assertEqual(
            orphans, set(),
            f"Orphaned fragment topics: {orphans}",
        )

    def test_fragment_arrays_not_empty(self):
        for topic_id, frags in self.fragment_map.items():
            with self.subTest(topic_id=topic_id):
                self.assertGreater(
                    len(frags.get("openers", [])), 0,
                    f"Empty openers for {topic_id}",
                )
                self.assertGreater(
                    len(frags.get("bodies", [])), 0,
                    f"Empty bodies for {topic_id}",
                )
                self.assertGreater(
                    len(frags.get("closers", [])), 0,
                    f"Empty closers for {topic_id}",
                )

    def test_no_empty_fragment_strings(self):
        """Openers and bodies must not be empty. Closers may include one empty
        string (intentional — allows sentences to end without a closing phrase)."""
        for topic_id, frags in self.fragment_map.items():
            for slot in ("openers", "bodies"):
                for i, text in enumerate(frags.get(slot, [])):
                    with self.subTest(topic_id=topic_id, slot=slot, index=i):
                        self.assertTrue(
                            text.strip(),
                            f"Empty {slot}[{i}] in {topic_id}",
                        )
            # Closers: at most one empty string allowed per topic
            closers = frags.get("closers", [])
            empty_count = sum(1 for c in closers if not c.strip())
            with self.subTest(topic_id=topic_id, slot="closers"):
                self.assertLessEqual(
                    empty_count, 1,
                    f"Too many empty closers ({empty_count}) in {topic_id}",
                )

    def test_minimum_combination_count(self):
        """Each topic should have at least 100 unique combinations (O×B×C)."""
        for topic_id, frags in self.fragment_map.items():
            with self.subTest(topic_id=topic_id):
                combos = (
                    len(frags.get("openers", []))
                    * max(len(frags.get("bodies", [])), 1)
                    * max(len(frags.get("closers", [])), 1)
                )
                self.assertGreaterEqual(
                    combos, 100,
                    f"Only {combos} combos for {topic_id} — need more variety",
                )


class TestSentimentsDataset(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = load_json(SENTIMENTS_PATH)
        cls.sentiments = cls.data.get("sentiments", [])

    def test_file_loads(self):
        self.assertIn("sentiments", self.data)
        self.assertGreater(len(self.sentiments), 0)

    def test_has_version(self):
        self.assertIn("version", self.data)

    def test_all_sentiments_have_id_and_color(self):
        for sent in self.sentiments:
            with self.subTest(sentiment_id=sent.get("id", "MISSING")):
                self.assertTrue(sent.get("id"), "Missing id")
                self.assertTrue(sent.get("color"), "Missing color")

    def test_colors_are_valid_hex(self):
        import re
        pattern = re.compile(r"^#[0-9A-Fa-f]{6}$")
        for sent in self.sentiments:
            with self.subTest(sentiment_id=sent["id"]):
                self.assertRegex(
                    sent["color"], pattern,
                    f"Invalid color '{sent['color']}' for sentiment '{sent['id']}'",
                )

    def test_no_flag_color_collisions(self):
        """Sentiment colors must not collide with flag hues (red, yellow, blue, orange)."""
        for sent in self.sentiments:
            color = sent.get("color", "#000000")
            # Skip achromatic colors (grey/black/white)
            h = color.lstrip("#")
            r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
            if r == g == b:
                continue  # achromatic, no hue to collide

            hue = hex_to_hue(color)
            _, sat, _ = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if sat < 0.1:
                continue  # very low saturation, effectively grey

            flag = hue_collides_with_flag(hue)
            with self.subTest(sentiment_id=sent["id"], hue=round(hue, 1)):
                self.assertIsNone(
                    flag,
                    f"Sentiment '{sent['id']}' color {color} (hue {hue:.0f}°) "
                    f"collides with {flag} flag"
                    + (f" (hue {FLAG_HUES[flag]}°)" if flag else ""),
                )


class TestCrossReferences(unittest.TestCase):
    """Cross-dataset integrity checks."""

    @classmethod
    def setUpClass(cls):
        cls.topics = load_json(TOPICS_PATH).get("topics", [])
        cls.fragments = {
            f["topicId"]: f
            for f in load_json(FRAGMENTS_PATH).get("fragments", [])
        }
        cls.sentiments = {
            s["id"]: s
            for s in load_json(SENTIMENTS_PATH).get("sentiments", [])
        }

    def test_topic_sentiments_exist_in_sentiments_file(self):
        """If a topic references a sentiment, it must exist in sentiments.json."""
        for topic in self.topics:
            sentiment = topic.get("sentiment")
            if sentiment:
                with self.subTest(topic_id=topic["id"], sentiment=sentiment):
                    self.assertIn(
                        sentiment, self.sentiments,
                        f"Topic '{topic['id']}' references unknown sentiment '{sentiment}'",
                    )

    def test_unique_topic_ids(self):
        ids = [t["id"] for t in self.topics]
        self.assertEqual(len(ids), len(set(ids)), "Duplicate topic IDs found")

    def test_unique_fragment_topic_ids(self):
        frag_data = load_json(FRAGMENTS_PATH).get("fragments", [])
        ids = [f["topicId"] for f in frag_data]
        self.assertEqual(len(ids), len(set(ids)), "Duplicate fragment topic IDs found")


if __name__ == "__main__":
    # Allow running from any directory
    os.chdir(Path(__file__).resolve().parent.parent)
    unittest.main(verbosity=2)
