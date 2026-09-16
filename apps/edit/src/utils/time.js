// ═══════════════════════════════════════════════════════════════
// TIME UTILITIES — Timecode parsing and formatting
// ═══════════════════════════════════════════════════════════════

/**
 * Parse a duration string like "5:00" or "1:23:45" into seconds.
 */
export function parseDuration(str) {
  if (typeof str === 'number') return str;
  const parts = str.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

/**
 * Format seconds as "M:SS" or "H:MM:SS".
 */
export function formatDuration(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
  return m + ':' + pad(s);
}

/**
 * Format seconds as FFmpeg-compatible timestamp "HH:MM:SS.mmm".
 */
export function toFFmpegTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  return pad(h) + ':' + pad(m) + ':' + s.toFixed(3).padStart(6, '0');
}
