import type { SimState, TradingPaints } from "../types";

/// What Trading Paints and the sim are about to do to the paint folder.
///
/// The plan asks for "is the downloader running". The downloader's own config says more than
/// that, so the banner names the specific setting that can undo an apply rather than making
/// the user go and look.
export function Guards({ tp, sim }: { tp: TradingPaints | null; sim: SimState | null }) {
  const lines: { text: string; bad: boolean }[] = [];

  if (sim?.simRunning) {
    lines.push({
      text: "iRacing is running. It holds paint files open, so a swap can fail halfway.",
      bad: true,
    });
  } else if (sim?.uiRunning) {
    lines.push({
      text: "The iRacing launcher is open. Starting a session will lock these files.",
      bad: false,
    });
  }

  for (const w of tp?.warnings ?? []) {
    lines.push({ text: w, bad: !!tp?.running });
  }

  if (lines.length === 0) return null;
  const anyBad = lines.some((l) => l.bad);

  return (
    <div className={`banner ${anyBad ? "bad" : "warn"}`}>
      <span className="mark">!</span>
      <div>
        <strong>{anyBad ? "Worth stopping for" : "Worth knowing"}</strong>
        <ul>
          {lines.map((l) => (
            <li key={l.text}>{l.text}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/// The downloader's settings, laid out so the risky ones are obvious.
export function TradingPaintsPanel({ tp }: { tp: TradingPaints | null }) {
  if (!tp) return null;
  if (!tp.configFound) {
    return (
      <div className="panel">
        <h3>Trading Paints</h3>
        <div className="note">
          No downloader config found{tp.configPath ? ` at ${tp.configPath}` : ""}. Nothing to
          warn about.
        </div>
      </div>
    );
  }

  const rows: { label: string; value: boolean | null; riskyWhen: boolean }[] = [
    { label: "Download my schemes (overwrites your car)", value: tp.downloadMySchemes, riskyWhen: true },
    { label: "Keep my paints synced from website", value: tp.keepSynced, riskyWhen: true },
    { label: "Delete schemes before downloading", value: tp.deleteBeforeDownloading, riskyWhen: true },
    { label: "Delete schemes once session ends", value: tp.deleteAfterSession, riskyWhen: true },
  ];

  return (
    <div className="panel">
      <h3>Trading Paints</h3>
      <div className="rows">
        <div className="row-line">
          <span className="grow">Downloader running</span>
          <span className={`badge ${tp.running ? "guess" : "certain"}`}>
            {tp.running ? "yes" : "no"}
          </span>
        </div>
        {tp.userId && (
          <div className="row-line">
            <span className="grow">Configured customer</span>
            <span className="mono">{tp.userId}</span>
          </div>
        )}
        {rows.map((r) => (
          <div className="row-line" key={r.label}>
            <span className="grow">{r.label}</span>
            <span
              className={`badge ${
                r.value === null ? "" : r.value === r.riskyWhen ? "guess" : "certain"
              }`}
            >
              {r.value === null ? "unknown" : r.value ? "on" : "off"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
