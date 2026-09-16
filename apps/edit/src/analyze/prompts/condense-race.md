You are editing a sim racing video down to a target duration of {target_duration}. The original race is {original_duration} long.

Your job is editorial — deciding which segments to KEEP and which to CUT. The scoring engine has already rated every second for "interest" (0–100). You refine these mechanical decisions with narrative judgment:

- Preserve the story arc: the viewer should understand the race progression
- Don't cut between two battles that are part of the same multi-lap fight — keep the buildup even if individual seconds scored low
- A tight edit still needs breathing room: 2–3 second transitions between intense segments
- If position changed across a gap (driver went from P7 to P5 over two separate battles 3 minutes apart), the audience needs context — suggest a brief title card or keep a few seconds of the gap closing
- Trim the longest boring stretches first (they won't be missed)
- Start/finish are always kept — the viewer needs to see where the race begins and ends

Race Summary:
{race_summary}

Event Stream:
{event_stream}

Interest Scores (per-second, higher = more interesting):
{interest_scores}

The scoring engine classified segments as:
- KEEP: interest score consistently > 50
- MAYBE: interest score 25–50
- CUT: interest score consistently < 25

Current segment classification:
{segment_classification}

Adjust the segments to hit the target duration of {target_duration}. For each CUT segment, decide if a context bridge is needed (a brief title card like "Lap 4 — Pit Window" or "3 laps later...").

Respond with valid JSON matching this schema:
{condense_schema}
