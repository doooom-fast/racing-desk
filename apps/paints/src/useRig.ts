import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "./api";
import { deskRig } from "./bridge";
import { boundRow, carKey, readRig, withoutProfile, type Rig } from "./rig";

/// How the last change to a car's pedals went, said beside its profile.
export interface PedalNote {
  kind: "saved" | "failed";
  text: string;
}

export interface RigState {
  /// Whether there is an app to ask. Without one the view and the pedals say so, and nothing is read.
  here: boolean;
  /// What was last read; null until the first answer is in.
  rig: Rig | null;
  /// The cars whose pedals are being saved, by key, each with the profile asked for (null for none).
  saving: ReadonlyMap<string, string | null>;
  notes: ReadonlyMap<string, PedalNote>;
  refresh: () => Promise<void>;
  bind: (carPath: string, profileId: string | null) => Promise<void>;
}

const isRow = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/// What the host keeps per car, read through the app: when the page is mounted, each time the desk shows it
/// again, and when the desk says to (`racingdesk:refresh`: its Refresh, the host found after none was, the store
/// with something new) or the page's own Refresh is pressed. Each answer is numbered, as the list of cars is:
/// what is shown is the last one asked for, not the last to arrive.
export function useRig(): RigState {
  const [rig, setRig] = useState<Rig | null>(null);
  const [saving, setSaving] = useState<ReadonlyMap<string, string | null>>(new Map());
  const [notes, setNotes] = useState<ReadonlyMap<string, PedalNote>>(new Map());
  const asked = useRef(0);
  /// The read that is on its way, and its number.
  const reading = useRef<{ mine: number; done: Promise<void> } | null>(null);

  const refresh = useCallback((): Promise<void> => {
    const bridge = deskRig();
    if (!bridge) return Promise.resolve();
    // Asked for twice in one breath — the desk shows the page again and says there is something new — it is
    // read once: the read on its way is the latest there is.
    if (reading.current?.mine === asked.current) return reading.current.done;
    const mine = ++asked.current;
    const done = (async () => {
      let answer: unknown;
      try {
        answer = await bridge.read();
      } catch (e) {
        // The app never rejects; if a bridge ever does, that is why nothing could be read.
        const error = errorText(e);
        answer = { cars: { error }, views: { error }, pedals: { error } };
      }
      if (reading.current?.mine === mine) reading.current = null;
      if (mine !== asked.current) return;
      setNotes(new Map());
      setRig(readRig(answer));
    })();
    reading.current = { mine, done };
    return done;
  }, []);

  useEffect(() => {
    void refresh();
    const shown = (e: Event) => {
      if ((e as CustomEvent).detail === "cars") void refresh();
    };
    const again = () => void refresh();
    document.addEventListener("racingdesk:page", shown);
    document.addEventListener("racingdesk:refresh", again);
    return () => {
      document.removeEventListener("racingdesk:page", shown);
      document.removeEventListener("racingdesk:refresh", again);
    };
  }, [refresh]);

  const bind = useCallback(async (carPath: string, profileId: string | null) => {
    const bridge = deskRig();
    if (!bridge) return;
    const key = carKey(carPath);
    const without = <T,>(map: ReadonlyMap<string, T>) => {
      const next = new Map(map);
      next.delete(key);
      return next;
    };
    setSaving((current) => new Map(current).set(key, profileId));
    setNotes(without);

    let result: unknown;
    try {
      result = await bridge.bindPedals(carPath, profileId);
    } catch (e) {
      result = { ok: false, error: errorText(e) };
    }
    const saved = isRow(result) && result.ok === true;
    if (saved) {
      // A read that was on its way may have been answered before the host took this: it is not shown.
      asked.current += 1;
      const row = boundRow(isRow(result) ? result.car : null, carPath);
      setRig((current) => {
        if (!current?.pedals) return current;   // read again meanwhile, from a host without pedals
        const cars = new Map(current.pedals.cars);
        const had = cars.get(key);
        if (row) cars.set(key, row);
        // With its profile taken away, the force the car was driven with is still the host's to show, and the
        // host has it down as the driver's choice that the car has none.
        else if (current.pedals.told || (had && had.brakeForceKg !== null)) {
          const bare = withoutProfile(carPath, had);
          cars.set(key, current.pedals.told ? bare : { ...bare, givenBy: null });
        } else cars.delete(key);
        const paths = current.paths.has(key) ? current.paths : new Map(current.paths).set(key, carPath);
        return { ...current, paths, pedals: { ...current.pedals, cars } };
      });
    }
    const why =
      isRow(result) && typeof result.error === "string" && result.error ? result.error : "no reason given";
    setNotes((current) =>
      new Map(current).set(
        key,
        saved ? { kind: "saved", text: "saved" } : { kind: "failed", text: `not saved: ${why}` },
      ),
    );
    setSaving(without);
  }, []);

  return { here: deskRig() !== null, rig, saving, notes, refresh, bind };
}
