// When each car was last driven. The desk works it out from the sessions it has already read for its own page
// (apps/overlay/modules/desk/desk.js) and hands it over — island.tsx's setLastDriven — so nothing is asked of the
// host twice. It can arrive before the page is mounted or long after, so it is kept here and not in the App.
// Outside the desk nobody hands anything over, and nothing is said.
import { useSyncExternalStore } from "react";
import { carKey } from "./rig";

let last: ReadonlyMap<string, string> = new Map();
const listeners = new Set<() => void>();

/// `byCar` is each car's path and the start of the latest session driven in it, as an ISO date.
export function setLastDriven(byCar: unknown): void {
  const next = new Map<string, string>();
  if (byCar !== null && typeof byCar === "object") {
    for (const [path, iso] of Object.entries(byCar)) {
      if (typeof iso === "string" && !Number.isNaN(Date.parse(iso))) next.set(carKey(path), iso);
    }
  }
  last = next;
  for (const tell of listeners) tell();
}

function subscribe(tell: () => void): () => void {
  listeners.add(tell);
  return () => {
    listeners.delete(tell);
  };
}

/// By car key (rig.ts, `carKey`).
export const useLastDriven = (): ReadonlyMap<string, string> =>
  useSyncExternalStore(subscribe, () => last);
