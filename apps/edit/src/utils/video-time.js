// ═══════════════════════════════════════════════════════════════
// VIDEO TIME — the sidecar's clock against the video's own
//
// A frame's `t` is seconds from the moment OBS said the recording
// had started (the header's zero). The file does not begin then: an
// output joining a running encoder waits for the next keyframe, so
// the video's own time is `t` plus the summary's `videoOffsetMs`
// (found once the file was finished: docs/telemetry-sidecar-schema.md).
// A recording that was paused has `pauses` ([{ from, to }], ms of
// `t`): the video's clock stood still for each and the sidecar's did
// not, so a moment after a pause is that much earlier in the video.
//
// Everything the editor decides — events, scores, segments, cuts — is
// in `t`. This is the one place it becomes the video's time, at the
// render, and the one place the video's time (silence) becomes `t`.
// ═══════════════════════════════════════════════════════════════

/**
 * The recording's clock, from the sidecar's last summary.
 * A sidecar with no summary, or one whose offset could not be found
 * (`alignment.method: "none"`), is read as `t` = video time, as before:
 * `known` says which.
 * @param {Object|null} summary - The sidecar's last summary line (session.sidecarSummary)
 * @returns {{ offsetMs: number, pauses: Array<{from: number, to: number}>, known: boolean, method: string|null, approximate: boolean }}
 */
export function videoClock(summary) {
  const s = summary && typeof summary === 'object' ? summary : {};
  const method = typeof s.alignment?.method === 'string' ? s.alignment.method : null;
  const known = Number.isFinite(s.videoOffsetMs) && method !== 'none';
  const offsetMs = known ? s.videoOffsetMs : 0;
  const pauses = cleanPauses(s.pauses);
  return {
    offsetMs,
    pauses,
    known,
    method,
    approximate: known && (s.alignment?.approximate === true || pauses.length > 0),
  };
}

/**
 * Sidecar time → video time, in seconds.
 * A moment inside a pause is where the video stopped: the pause's start.
 * May be negative (before the file's first frame) or beyond its end.
 */
export function toVideoTime(clock, t) {
  const ms = t * 1000;
  let paused = 0;
  for (const p of clock.pauses) {
    if (p.from >= ms) break;
    paused += Math.min(ms, p.to) - p.from;
  }
  return (ms + clock.offsetMs - paused) / 1000;
}

/**
 * Video time → sidecar time, in seconds: the first moment of the
 * sidecar the video shows at that time (a pause's start, at a pause).
 */
export function toSidecarTime(clock, v) {
  const shown = v * 1000 - clock.offsetMs;   // ms of `t` with the pauses so far taken out
  let paused = 0;
  for (const p of clock.pauses) {
    if (shown <= p.from - paused) break;
    paused += p.to - p.from;
  }
  return (shown + paused) / 1000;
}

/**
 * A stretch of sidecar time as the stretch of the video that shows it,
 * held to the file: from 0, and to its duration where that is known.
 * A pause inside the stretch is not in the video, so the stretch is
 * shorter by it and still one piece. Null when none of it is in the
 * video (before the file began, after it ended, or all inside a pause).
 * @param {number} start - Sidecar seconds
 * @param {number} end - Sidecar seconds
 * @param {number} [durationSec] - The video's duration; 0 or absent when not known
 * @returns {{ start: number, end: number } | null}
 */
export function videoRange(clock, start, end, durationSec = 0) {
  let vs = Math.max(0, toVideoTime(clock, start));
  let ve = toVideoTime(clock, end);
  if (durationSec > 0) ve = Math.min(ve, durationSec);
  if (!(ve - vs >= MIN_RANGE_SEC)) return null;
  return { start: round3(vs), end: round3(ve) };
}

/** Shorter than this is not a cut ffmpeg can make anything of. */
export const MIN_RANGE_SEC = 0.05;

/** One line on how the video is lined up, for the command line. */
export function describeClock(clock) {
  if (!clock.known) return 'Video offset not known: telemetry time is taken as video time.';
  const sign = clock.offsetMs >= 0 ? '+' : '−';
  const by = clock.method ? ` (lined up by ${clock.method})` : '';
  const paused = clock.pauses.length
    ? `, ${clock.pauses.length} pause${clock.pauses.length === 1 ? '' : 's'} taken out`
    : '';
  const approx = clock.approximate ? ', approximate' : '';
  return `Video is telemetry time ${sign}${Math.abs(clock.offsetMs)} ms${by}${paused}${approx}.`;
}

/** The pauses that can be used: finite, from before to, in order, overlaps joined. */
function cleanPauses(pauses) {
  if (!Array.isArray(pauses)) return [];
  const list = pauses
    .filter((p) => p && Number.isFinite(p.from) && Number.isFinite(p.to) && p.to > p.from)
    .map((p) => ({ from: p.from, to: p.to }))
    .sort((a, b) => a.from - b.from);
  const joined = [];
  for (const p of list) {
    const last = joined[joined.length - 1];
    if (last && p.from <= last.to) last.to = Math.max(last.to, p.to);
    else joined.push(p);
  }
  return joined;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}
