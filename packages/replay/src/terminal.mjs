// Keyboard transport controls + status line for an interactive terminal.

export const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function attachTerminalControls(replay, { onQuit } = {}) {
  if (!process.stdin.isTTY) return false;
  console.log('  space pause · ←/→ ±10s · [/] speed · 0 restart · q quit');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (buf) => {
    const k = buf.toString();
    const { clock } = replay;
    if (k === 'q' || k === '') return onQuit?.();
    if (k === ' ') clock.paused ? clock.resume() : clock.pause();
    else if (k === '[C') clock.seek(clock.now() + 10000);
    else if (k === '[D') clock.seek(Math.max(0, clock.now() - 10000));
    else if (k === ']') clock.setSpeed(Math.min(clock.speed * 2, 16));
    else if (k === '[') clock.setSpeed(Math.max(clock.speed / 2, 0.125));
    else if (k === '0') clock.seek(0);
  });
  setInterval(() => {
    const s = replay.state();
    process.stdout.write(`\r  ${fmtTime(s.t)} / ${fmtTime(s.duration)}  frame ${s.frame}  ${s.speed}x${s.paused ? '  paused' : ''}     `);
  }, 250).unref();
  return true;
}
