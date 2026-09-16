#!/usr/bin/env python3
"""
Generate commentary fragments for the Media Broadcaster plugin using Claude Haiku.

This script uses the Anthropic Messages API (claude-haiku-4-5 model) to generate
rich, diverse commentary fragments that can be composed at runtime to produce
unique, contextually-aware prompts without network latency during gameplay.

The fragments are generated from:
1. Existing commentary_topics.json (structure and context)
2. sentiments.json (vocabulary and tone references)
3. channel_notes.json (voice/style profile)
4. Additional style instructions for Kevin's voice

Generated fragments are written to commentary_fragments.json with the structure:
{
  "fragments": [
    {
      "topicId": "spin_catch",
      "fragments": {
        "openers": [...],
        "bodies": [...],
        "closers": [...]
      }
    },
    ...
  ]
}

USAGE:
------

1. Set your Anthropic API key in the environment:
   export ANTHROPIC_API_KEY='sk-ant-...'

2. Run the script:
   python3 generate_fragments.py

3. The script will output commentary_fragments.json in the dataset/ directory.
   Alternatively, specify an output path:
   python3 generate_fragments.py --output /path/to/output.json

OPTIONS:
--------

--output PATH
    Write generated fragments to PATH instead of dataset/commentary_fragments.json

--model MODEL_ID
    Use a different Claude model. Default: claude-haiku-4-5
    Other options: claude-opus-4-6, claude-sonnet-4-20250514

--topics-file PATH
    Load topics from PATH instead of dataset/commentary_topics.json

--sentiments-file PATH
    Load sentiments from PATH instead of dataset/sentiments.json

--channel-notes-file PATH
    Load channel notes from PATH instead of dataset/channel_notes.json

--dry-run
    Show the prompt that would be sent without making API calls

REQUIREMENTS:
-------------

- Python 3.7+
- anthropic library: pip install anthropic
- Valid ANTHROPIC_API_KEY environment variable

COST:
-----

Generating fragments for ~28 topics with Haiku:
- Input: ~25,000 tokens (topics + style context)
- Output: ~8,000 tokens (6 openers + 8 bodies + 5 closers per topic)
- Total: ~33,000 tokens ≈ $0.01-0.02 USD

CUSTOMIZATION:
---------------

The script can be modified to:
- Adjust the number of fragments per slot (openers, bodies, closers)
- Change the voice style by modifying the system prompt
- Add topics not in commentary_topics.json
- Filter topics by category or severity
- Generate different variants for different channels

EXAMPLE OUTPUT:
---------------

{
  "version": "1.0",
  "description": "Pre-generated commentary fragments...",
  "fragments": [
    {
      "topicId": "spin_catch",
      "fragments": {
        "openers": [
          "The rear came round.",
          "Massive snap right there.",
          ...
        ],
        "bodies": [
          "The car's telling you exactly what happens when you push past the edge.",
          ...
        ],
        "closers": [
          "Feel that feedback.",
          ""
        ]
      }
    }
  ]
}

TROUBLESHOOTING:
----------------

API Key not found:
  Set ANTHROPIC_API_KEY before running:
  export ANTHROPIC_API_KEY='sk-ant-...'

File not found errors:
  Ensure the dataset files exist in the relative paths or specify --topics-file, etc.

Rate limiting:
  If you get 429 errors, wait a few seconds and retry.
  The script does not implement automatic retries.

Output file permission errors:
  Ensure you have write access to the output directory.

FUTURE ENHANCEMENTS:
--------------------

1. Batch API calls for better performance on large topic sets
2. Caching of successful generations to avoid re-generating unchanged topics
3. Quality validation and scoring of generated fragments
4. Interactive mode to review and approve fragments before writing
5. Support for multiple voice profiles (different commentators)
6. Streaming output for real-time monitoring of generation
7. Integration with feedback.json to refine based on actual usage data
"""

import os
import sys
import json
import argparse
from pathlib import Path
from typing import Optional, Dict, List, Any


def main():
    parser = argparse.ArgumentParser(
        description="Generate commentary fragments for Media Broadcaster using Claude Haiku"
    )
    parser.add_argument(
        "--output",
        type=str,
        default="dataset/commentary_fragments.json",
        help="Output path for generated fragments"
    )
    parser.add_argument(
        "--model",
        type=str,
        default="claude-haiku-4-5-20251001",
        help="Claude model to use (default: claude-haiku-4-5-20251001)"
    )
    parser.add_argument(
        "--topics-file",
        type=str,
        default="dataset/commentary_topics.json",
        help="Path to commentary_topics.json"
    )
    parser.add_argument(
        "--sentiments-file",
        type=str,
        default="dataset/sentiments.json",
        help="Path to sentiments.json"
    )
    parser.add_argument(
        "--channel-notes-file",
        type=str,
        default="dataset/channel_notes.json",
        help="Path to channel_notes.json"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show the prompt without making API calls"
    )

    args = parser.parse_args()

    # Check API key
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY environment variable not set")
        print("Set it with: export ANTHROPIC_API_KEY='sk-ant-...'")
        sys.exit(1)

    # Load input files
    topics = load_json(args.topics_file)
    sentiments = load_json(args.sentiments_file)
    channel_notes = load_json(args.channel_notes_file, optional=True)

    if not topics or "topics" not in topics:
        print(f"ERROR: Could not load topics from {args.topics_file}")
        sys.exit(1)

    # Build the prompt
    prompt = build_generation_prompt(topics, sentiments, channel_notes)

    if args.dry_run:
        print("=== PROMPT THAT WOULD BE SENT TO CLAUDE ===\n")
        print(prompt)
        print("\n=== END PROMPT ===")
        return

    # Generate fragments
    print(f"Generating fragments with {args.model}...")
    fragments = generate_fragments(api_key, args.model, prompt)

    if not fragments:
        print("ERROR: Failed to generate fragments")
        sys.exit(1)

    # Write output
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    output_data = {
        "version": "1.0",
        "description": "Pre-generated commentary fragments for sentence composition at runtime. Generated with Haiku in Kevin's voice: first person, present tense, technically grounded, direct, no filler.",
        "fragments": fragments
    }

    with open(output_path, "w") as f:
        json.dump(output_data, f, indent=2)

    print(f"✓ Generated {len(fragments)} fragment topics")
    print(f"✓ Wrote to {output_path}")


def load_json(path: str, optional: bool = False) -> Optional[Dict[str, Any]]:
    """Load and parse a JSON file."""
    try:
        with open(path, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        if optional:
            return None
        print(f"ERROR: File not found: {path}")
        sys.exit(1)
    except json.JSONDecodeError:
        print(f"ERROR: Invalid JSON in {path}")
        sys.exit(1)


def build_generation_prompt(topics: Dict, sentiments: Optional[Dict], channel_notes: Optional[Dict]) -> str:
    """Build the prompt to send to Claude for fragment generation."""

    # Extract topic data for context
    topic_list = topics.get("topics", [])
    topics_context = "\n".join([
        f"- {t['id']}: {t['title']} (severity {t.get('severity', 2)}, "
        f"sentiment: {t.get('sentiment', 'neutral')})"
        for t in topic_list
    ])

    # Extract sentiment vocabulary
    sentiments_context = ""
    if sentiments and "sentiments" in sentiments:
        sentiments_context = "Sentiment vocabulary reference:\n"
        for s in sentiments["sentiments"]:
            phrases = ", ".join(s.get("phrases", [])[:3])
            sentiments_context += f"- {s['id']}: {phrases}...\n"

    # Get channel voice notes if available
    voice_notes = ""
    if channel_notes:
        # Would extract the active channel's voice profile here
        voice_notes = "Use the technical, direct, first-person voice from http://www.alternate.org"

    return f"""Generate commentary fragments for a sim racing dashboard plugin in Kevin's voice.

Kevin's voice profile:
- First person, present tense
- Technically grounded, specific
- Direct, no filler phrases
- 2-5 words for openers, 8-20 for bodies, 0-10 for closers
- No generic exclamations — specificity over energy
- Include placeholders like {{ahead}}, {{behind}} where contextually relevant
{voice_notes}

Available topics to generate fragments for:
{topics_context}

Sentiment vocabulary reference (use naturally, not forced):
{sentiments_context}

For EACH topic, generate exactly:
- 6 unique openers (2-5 words each) — punchy sentence starts
- 8 unique bodies (8-20 words) — the core message with context
- 5 unique closers (0-10 words) — optional wrap-ups, at least one empty string ""

Return valid JSON in this exact format:
{{
  "fragments": [
    {{
      "topicId": "spin_catch",
      "fragments": {{
        "openers": ["...", "...", ...],
        "bodies": ["...", "...", ...],
        "closers": ["...", "...", ""]
      }}
    }}
  ]
}}

Requirements:
- Each topic must have a topicId matching the input topics
- Fragments must be technically accurate and Kevin's actual voice
- Placeholders like {{ahead}}, {{behind}} are valid in bodies
- At least one closer per topic should be an empty string ""
- No generic phrases like "That's interesting" or "Let's see"
- Generate all topics with no skips

Start with the JSON output only, no preamble:
"""


def generate_fragments(api_key: str, model: str, prompt: str) -> Optional[List[Dict]]:
    """Call the Anthropic API to generate fragments."""
    try:
        from anthropic import Anthropic
    except ImportError:
        print("ERROR: anthropic library not installed")
        print("Install with: pip install anthropic")
        sys.exit(1)

    client = Anthropic(api_key=api_key)

    try:
        message = client.messages.create(
            model=model,
            max_tokens=16000,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )

        # Extract JSON from response
        response_text = message.content[0].text

        # Try to parse JSON from the response
        try:
            # Look for JSON in the response
            json_start = response_text.find('{')
            json_end = response_text.rfind('}') + 1
            if json_start >= 0 and json_end > json_start:
                json_str = response_text[json_start:json_end]
                data = json.loads(json_str)
                return data.get("fragments", [])
        except json.JSONDecodeError:
            print(f"ERROR: Could not parse JSON from response:\n{response_text[:500]}")
            return None

    except Exception as e:
        print(f"ERROR: API call failed: {e}")
        return None


if __name__ == "__main__":
    main()
