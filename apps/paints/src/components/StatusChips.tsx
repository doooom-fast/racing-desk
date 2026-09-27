import { useEffect, useRef, useState } from "react";
import type { Car, RepoStatus, SimState, TradingPaints } from "../types";

export type Level = "bad" | "warn" | "info";

export interface StatusItem {
  id: string;
  level: Level;
  /// Two or three words for the chip itself.
  short: string;
  /// The full sentence, shown when the chip is opened.
  detail: string;
}

/// Everything that used to be a stack of banners above the cars, as one line of chips.
///
/// The banners said the same things but cost most of the window's height, pushing the
/// version cards — the reason the app exists — below the fold. A chip keeps the warning
/// permanently visible and one click from its full text.
export function collectStatus(args: {
  sim: SimState | null;
  tp: TradingPaints | null;
  repo: RepoStatus | null;
  car: Car | null;
  idValid: boolean;
}): StatusItem[] {
  const { sim, tp, repo, car, idValid } = args;
  const items: StatusItem[] = [];

  if (!idValid) {
    items.push({
      id: "no-id",
      level: "bad",
      short: "No customer ID",
      detail: "Set a customer ID above before applying anything.",
    });
  }

  if (sim?.simRunning) {
    items.push({
      id: "sim",
      level: "bad",
      short: "iRacing running",
      detail:
        "iRacing is running. It holds paint files open, so a swap can fail halfway. Close the sim first.",
    });
  } else if (sim?.uiRunning) {
    items.push({
      id: "ui",
      level: "warn",
      short: "Launcher open",
      detail:
        "The iRacing launcher is open. That is harmless now, but starting a session will lock these files.",
    });
  }

  const tpWarnings = tp?.warnings ?? [];
  if (tpWarnings.length > 0) {
    items.push({
      id: "tp",
      level: tp?.running ? "bad" : "warn",
      short: `Trading Paints${tpWarnings.length > 1 ? ` ×${tpWarnings.length}` : ""}`,
      detail: tpWarnings.join(" "),
    });
  }

  if (car && !car.simFolder) {
    items.push({
      id: "no-sim-folder",
      level: "warn",
      short: "Car not in sim",
      detail: `There is no ${car.folder} folder in the paint directory. iRacing creates a car's folder the first time you drive it.`,
    });
  }

  if (repo?.updatesAvailable) {
    items.push({
      id: "repo",
      level: "info",
      short:
        repo.behind > 0
          ? `${repo.behind} update${repo.behind === 1 ? "" : "s"}`
          : "Updates waiting",
      detail:
        "New liveries are waiting in the library repo. Use Update under Library source to take them.",
    });
  }

  return items;
}

export function StatusChips({ items }: { items: StatusItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // A chip's detail should close when attention moves anywhere else.
  useEffect(() => {
    if (!openId) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpenId(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpenId(null);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [openId]);

  if (items.length === 0) {
    return (
      <div className="chips">
        <span className="chip ok" title="Nothing in the way of applying a paint">
          ready
        </span>
      </div>
    );
  }

  const open = items.find((i) => i.id === openId) ?? null;

  return (
    <div className="chips" ref={ref}>
      {items.map((i) => (
        <button
          key={i.id}
          className={`chip ${i.level} ${openId === i.id ? "open" : ""}`}
          onClick={() => setOpenId(openId === i.id ? null : i.id)}
          title={i.detail}
          aria-expanded={openId === i.id}
        >
          {i.short}
        </button>
      ))}
      {open && (
        <div className="chip-detail" role="dialog">
          {open.detail}
        </div>
      )}
    </div>
  );
}
