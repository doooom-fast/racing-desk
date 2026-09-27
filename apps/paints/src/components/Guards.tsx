import type { TradingPaints } from "../types";

// The warnings these settings produce are surfaced as chips in the header — see
// StatusChips. This panel is the detail behind them: the actual switches, with their
// current values, so a warning can be acted on rather than only read.

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
