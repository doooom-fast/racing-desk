// Records the plugin's localhost:8889 payload at a fixed rate into a replay file.

import { createRecordingWriter } from './format.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mirrors the overlay's visibility rule (poll-engine.js): demo mode, or game running with a session.
export const inCar = (p) =>
  Number(p['RaceCorProDrive.Plugin.DemoMode']) === 1 ||
  (Number(p['DataCorePlugin.GameRunning']) === 1 && Number(p['RaceCorProDrive.Plugin.Grid.SessionState']) > 0);

export async function record({ url, out, hz = 30, durationSec = 0, onlyInCar = false, signal, log = () => {}, onFrame = () => {} }) {
  const writer = createRecordingWriter(out, { source: url, startedAt: new Date().toISOString(), hz, onlyInCar });
  const interval = 1000 / hz;
  const t0 = performance.now();
  let next = t0, offset = 0, gapStartedAt = null;
  let polled = 0, skipped = 0, failures = 0;

  try {
    while (!signal?.aborted) {
      const now = performance.now();
      if (durationSec && now - t0 >= durationSec * 1000) break;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        if (failures) log(`source back after ${failures} failed polls`);
        failures = 0;
        polled++;
        const at = performance.now();
        if (onlyInCar && !inCar(payload)) {
          skipped++;
          gapStartedAt ??= at;
        } else {
          if (gapStartedAt !== null) { offset += at - gapStartedAt; gapStartedAt = null; }
          writer.write(Math.round(at - t0 - offset), payload);
          onFrame({ polled, written: writer.frames, skipped });
        }
      } catch (err) {
        if (signal?.aborted) break;
        if (failures++ === 0) log(`poll failed (${err.message}) — retrying every second`);
        await sleep(1000);
        next = performance.now();
        continue;
      }
      next += interval;
      const wait = next - performance.now();
      if (wait > 0) await sleep(wait); else if (wait < -interval) next = performance.now();
    }
  } finally {
    await writer.close();
  }
  return { out, polled, written: writer.frames, skipped, seconds: (performance.now() - t0) / 1000 };
}
