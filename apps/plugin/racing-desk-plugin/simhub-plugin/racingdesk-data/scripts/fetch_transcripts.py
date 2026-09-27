#!/usr/bin/env python3
"""
fetch_transcripts.py

Fetches video lists and transcripts from the configured YouTube channels,
filters for sim-racing relevant content, and extracts commentary topics/phrases.

Requirements:
    pip install yt-dlp youtube-transcript-api

Usage:
    python3 fetch_transcripts.py
    python3 fetch_transcripts.py --channel jimmy_broadbent
    python3 fetch_transcripts.py --max-videos 10
"""

import json
import os
import re
import argparse
import subprocess
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DATASET_DIR = Path(__file__).parent.parent
CHANNELS_FILE = DATASET_DIR / "channel_notes.json"
OUTPUT_DIR = DATASET_DIR / "transcripts"

# Keywords used to identify sim-racing relevant videos (title/description filter)
RELEVANT_KEYWORDS = [
    "iracing", "assetto corsa", "acc", "automobilista", "ams2",
    "setup", "force feedback", "ffb",
    "tire", "tyre", "lap time", "race", "qualifying", "overtake",
    "hotlap", "hot lap", "onboard", "cockpit", "car", "sim racing",
    "irating", "safety rating", "oval", "road", "gt3", "gt4",
    "lmp", "prototype", "formula", "endurance", "sprint"
]

# Keywords that indicate non-relevant videos to skip
SKIP_KEYWORDS = [
    "real life", "real racing", "hardware review", "rig tour",
    "life update", "vlog", "unboxing", "review", "buying guide",
    "best wheel", "best pedals", "budget", "setup tour"
]


def load_channels():
    with open(CHANNELS_FILE) as f:
        data = json.load(f)
    return data["channels"]


def is_relevant_video(title: str, description: str = "") -> bool:
    """Return True if the video is likely sim-racing gameplay/commentary content."""
    text = (title + " " + description).lower()
    if any(kw in text for kw in SKIP_KEYWORDS):
        return False
    return any(kw in text for kw in RELEVANT_KEYWORDS)


def get_channel_videos(channel_url: str, max_videos: int = 50) -> list[dict]:
    """Use yt-dlp to get video metadata for a channel."""
    print(f"  Fetching video list from {channel_url}...")
    cmd = [
        "yt-dlp",
        "--flat-playlist",
        "--print", "%(id)s\t%(title)s\t%(description)s",
        "--playlist-end", str(max_videos),
        channel_url + "/videos"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ERROR: {result.stderr[:200]}")
        return []

    videos = []
    for line in result.stdout.strip().splitlines():
        parts = line.split("\t", 2)
        if len(parts) >= 2:
            vid_id, title = parts[0], parts[1]
            desc = parts[2] if len(parts) > 2 else ""
            videos.append({"id": vid_id, "title": title, "description": desc})

    return videos


def get_transcript(video_id: str) -> list[dict] | None:
    """Fetch transcript for a video using youtube-transcript-api."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        return transcript  # List of {"text": ..., "start": ..., "duration": ...}
    except Exception as e:
        print(f"    Transcript unavailable for {video_id}: {e}")
        return None


def extract_phrases_from_transcript(transcript: list[dict]) -> list[dict]:
    """
    Extract notable phrases from transcript segments.
    Returns list of {"timestamp": float, "text": str, "category": str}.
    """
    phrases = []

    # Patterns that suggest notable commentary moments
    patterns = {
        "car_response": [
            r"(oversteer|understeer|push|loose|snap|rotate|grip|slide|traction)",
            r"(tire|tyre).*(temp|wear|pressure|deg)",
            r"(brake|braking).*(point|pressure|bias|lock)",
            r"(throttle|power).*(exit|on|application)"
        ],
        "hardware": [
            r"(force feedback|ffb).*(feel|setting|strong|weak|clipping)",
            r"(wheel|pedal|rig).*(feel|setup|hardware)",
            r"(load cell|hydraulic|heusinkveld|fanatec|moza|simagic)"
        ],
        "game_feel": [
            r"(sim|simulator|game).*(feel|physics|model|realistic)",
            r"(sound|audio|engine).*(note|sound|great|bad)",
            r"(fov|resolution|frame|graphics|visual)"
        ],
        "racing_experience": [
            r"(pass|passed|overtake|move|position)",
            r"(mistake|error|off|spin|crash|incident|penalty)",
            r"(strategy|pit|fuel|lap time|delta|gap)"
        ]
    }

    for entry in transcript:
        text = entry.get("text", "").strip()
        timestamp = entry.get("start", 0)

        for category, pattern_list in patterns.items():
            for pattern in pattern_list:
                if re.search(pattern, text, re.IGNORECASE):
                    phrases.append({
                        "timestamp": round(timestamp, 1),
                        "text": text,
                        "category": category
                    })
                    break  # Don't double-count same segment

    return phrases


def process_channel(channel: dict, max_videos: int = 50, output_dir: Path = OUTPUT_DIR):
    channel_id = channel["id"]
    channel_url = channel["url"]
    print(f"\nProcessing: {channel['handle']}")

    output_path = output_dir / channel_id
    output_path.mkdir(parents=True, exist_ok=True)

    videos = get_channel_videos(channel_url, max_videos)
    relevant = [v for v in videos if is_relevant_video(v["title"], v["description"])]
    print(f"  {len(relevant)}/{len(videos)} videos are relevant")

    all_phrases = []
    video_index = []

    for video in relevant:
        vid_id = video["id"]
        title = video["title"]
        print(f"  [{vid_id}] {title[:60]}")

        transcript = get_transcript(vid_id)
        if not transcript:
            continue

        phrases = extract_phrases_from_transcript(transcript)
        print(f"    → {len(phrases)} notable phrases extracted")

        for p in phrases:
            p["video_id"] = vid_id
            p["video_title"] = title

        all_phrases.extend(phrases)
        video_index.append({
            "id": vid_id,
            "title": title,
            "phrase_count": len(phrases)
        })

        # Save raw transcript
        transcript_file = output_path / f"{vid_id}.json"
        with open(transcript_file, "w") as f:
            json.dump({
                "video_id": vid_id,
                "title": title,
                "transcript": transcript,
                "extracted_phrases": phrases
            }, f, indent=2)

    # Save channel summary
    summary_file = output_path / "summary.json"
    with open(summary_file, "w") as f:
        json.dump({
            "channel_id": channel_id,
            "handle": channel["handle"],
            "videos_processed": len(video_index),
            "total_phrases": len(all_phrases),
            "videos": video_index,
            "all_phrases": all_phrases
        }, f, indent=2)

    print(f"  Saved to {summary_file}")
    return all_phrases


def aggregate_phrases(output_dir: Path):
    """Merge all channel phrase summaries into a single aggregated dataset."""
    all_phrases = []
    for summary_file in output_dir.glob("*/summary.json"):
        with open(summary_file) as f:
            data = json.load(f)
        channel_id = data.get("channel_id", "unknown")
        for phrase in data.get("all_phrases", []):
            phrase["channel_id"] = channel_id
            all_phrases.append(phrase)

    # Group by category
    by_category = {}
    for phrase in all_phrases:
        cat = phrase.get("category", "other")
        by_category.setdefault(cat, []).append(phrase)

    aggregated_file = output_dir / "aggregated_phrases.json"
    with open(aggregated_file, "w") as f:
        json.dump({
            "total_phrases": len(all_phrases),
            "by_category": by_category
        }, f, indent=2)

    print(f"\nAggregated {len(all_phrases)} phrases → {aggregated_file}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Fetch YouTube transcripts for Media Broadcaster dataset")
    parser.add_argument("--channel", help="Process only this channel ID (e.g. jimmy_broadbent)")
    parser.add_argument("--max-videos", type=int, default=50, help="Max videos per channel (default: 50)")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    channels = load_channels()

    if args.channel:
        channels = [c for c in channels if c["id"] == args.channel]
        if not channels:
            print(f"ERROR: Channel '{args.channel}' not found in channel_notes.json")
            return

    for channel in channels:
        process_channel(channel, max_videos=args.max_videos)

    aggregate_phrases(OUTPUT_DIR)
    print("\nDone.")


if __name__ == "__main__":
    main()
