import { useEffect, useRef, useState } from "react";
import type { CatalogueCar, RepoStatus, SimState, TradingPaints } from "../types";

export type Level = "bad" | "warn" | "info";

export interface StatusItem {
  id: string;
  level: Level;
  /// Two or three words for the chip itself.
  short: string;
  /// The full sentence, shown when the chip is opened.
  detail: string;
  /// Something to do about it, as a button under the sentence.
  action?: { label: string; run: () => void };
}

/// Where the library's own updates stand, for the one chip they get.
export interface LibraryUpdate {
  /// An update is being taken now.
  updating: boolean;
  /// What is in the way of the last one, as one plain sentence, said as it was worked out; null when nothing is.
  /// `retry`: trying again could put it right — a file held open for a moment, a remote that did not answer — as it
  /// cannot for changes or work of the library's own.
  blocked: { text: string; retry: boolean } | null;
  /// The library takes its updates by itself.
  auto: boolean;
  onUpdate: () => void;
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
  library: LibraryUpdate;
  car: CatalogueCar | null;
  idValid: boolean;
}): StatusItem[] {
  const { sim, tp, repo, library, car, idValid } = args;
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

  // Only for a car with something to apply: most cars in the list have no livery, and a warning about
  // where one would go is noise until there is one.
  if (car && car.versions.length > 0 && !car.simFolder) {
    items.push({
      id: "no-sim-folder",
      level: "warn",
      short: car.installed ? "No paint folder" : "Car not in sim",
      detail: `There is no ${car.folder} folder in the paint directory. iRacing creates a car's folder the first time you drive it.`,
    });
  }

  // The library's updates are one chip, and none of them sends him anywhere else: what is going on, what is in the
  // way (a sentence of its own, said the way it was worked out), or that they are waiting and a button to take them.
  // With it turned off, what is in the way keeps the button where trying again could help: the only other one is
  // under Library source, and he is not sent there. Turned on, it tries again itself.
  if (library.updating) {
    items.push({
      id: "repo",
      level: "info",
      short: "Updating library…",
      detail: "New liveries are being added to the library.",
    });
  } else if (library.blocked) {
    items.push({
      id: "repo",
      level: "warn",
      short: "Library not updated",
      detail: library.blocked.text,
      action: library.blocked.retry && !library.auto ? { label: "Update now", run: library.onUpdate } : undefined,
    });
  } else if (repo?.updatesAvailable) {
    items.push({
      id: "repo",
      level: "info",
      short:
        repo.behind > 0
          ? `${repo.behind} update${repo.behind === 1 ? "" : "s"}`
          : "Updates waiting",
      detail: library.auto
        ? "New liveries are waiting. The library takes them by itself when it can, and not while iRacing is running."
        : "New liveries are waiting to be added to the library.",
      action: { label: "Update now", run: library.onUpdate },
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

  // A chip that has gone takes its detail with it: not to come back open when it does.
  useEffect(() => {
    if (openId && !items.some((i) => i.id === openId)) setOpenId(null);
  }, [items, openId]);

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
          {open.action && (
            <div className="actions">
              <button className="primary" onClick={open.action.run}>
                {open.action.label}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
