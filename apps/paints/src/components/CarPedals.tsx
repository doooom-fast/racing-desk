import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { curveShape, keyWords, plain, type CarPedals, type Profile, type Rig } from "../rig";
import type { PedalNote } from "../useRig";

const NOT_HERE = "A car's pedals are kept by the Racing Desk app, and this page is running without it.";
const READING = "Reading what the host has…";
const NO_PATH =
  "The host has no name for this car — it has not been in one of your sessions — so there is nothing to keep its pedals against yet.";

const n = (value: number) => <span className="n">{plain(value)}</span>;

/// One line beside the profile: its brake as SmartControl has it now, whether the profile is still what the
/// car was given, and the brake force kept for the car itself.
function words(bound: CarPedals | null, profile: Profile | null): ReactNode {
  const parts: ReactNode[] = [];
  if (profile) {
    const brake = profile.brake;
    if (!brake) parts.push("no brake in this profile");
    else {
      if (brake.maxForceKg !== null) parts.push(<>brake max {n(brake.maxForceKg)} kg</>);
      if (brake.deadzoneBottom !== null) parts.push(<>bottom deadzone {n(brake.deadzoneBottom)}%</>);
      const shape = curveShape(brake.curve);
      if (shape) parts.push(`${shape} curve`);
    }
  }
  if (bound?.profileNow === "changed") {
    parts.push(<span className="warn">edited in SmartControl since this car was given it</span>);
  }
  if (bound?.profileNow === "gone") parts.push(<span className="warn">deleted in SmartControl</span>);
  if (bound && bound.brakeForceKg !== null) parts.push(<>brake force {n(bound.brakeForceKg)} kg in this car</>);
  if (parts.length === 0) return null;
  return (
    <span className="brake">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

/// A car's pedals: which of SmartControl's profiles it is driven with, chosen here once per car, and what
/// that profile's brake is. The choice is the one thing the page writes to the host, through the app; nothing
/// here changes the pedals themselves. A profile SmartControl no longer has stays in the car's own list, so
/// the select says what the host has, not "none".
export function CarPedalsPanel({
  here,
  rig,
  carName,
  carPath,
  bound,
  saving,
  note,
  onBind,
}: {
  /// Whether there is an app to have asked.
  here: boolean;
  /// What the host answered; null while the first answer is on its way.
  rig: Rig | null;
  carName: string;
  /// The host's own spelling of the car's path; null for a car it has never heard of.
  carPath: string | null;
  bound: CarPedals | null;
  /// The profile being saved for this car (null for none); undefined while nothing is.
  saving: string | null | undefined;
  note: PedalNote | null;
  onBind: (carPath: string, profileId: string | null) => void;
}) {
  const select = useRef<HTMLSelectElement>(null);
  const held = useRef(false);
  const busy = saving !== undefined;

  // The select is off while the host is asked, which takes the keyboard from it. It goes back once the answer
  // is in, unless the driver has moved on to something else meanwhile.
  useEffect(() => {
    if (busy || !held.current) return;
    held.current = false;
    const now = document.activeElement;
    if (!now || now === document.body || !now.isConnected) select.current?.focus();
  }, [busy]);

  const pedals = rig?.pedals ?? null;
  if (!here || rig === null || pedals === null) {
    return (
      <div className="panel car-pedals">
        <h3>Pedals</h3>
        <div className="note">{!here ? NOT_HERE : rig === null ? READING : rig.pedalsNote}</div>
      </div>
    );
  }

  const boundId = bound?.profileId ?? null;
  const profile = boundId === null ? null : (pedals.profiles.find((p) => p.id === boundId) ?? null);
  const says = words(bound, profile);

  return (
    <div className="panel car-pedals">
      <h3>Pedals</h3>
      {pedals.found ? (
        <div className="pedals-line">
          <label htmlFor="car-pedals-profile">Profile</label>
          <select
            id="car-pedals-profile"
            ref={select}
            aria-label={`Pedal profile for ${carName}`}
            value={(busy ? saving : boundId) ?? ""}
            disabled={busy || carPath === null}
            onChange={(e) => {
              if (carPath === null) return;
              held.current = document.activeElement === select.current;
              onBind(carPath, e.target.value === "" ? null : e.target.value);
            }}
          >
            <option value="">no profile of its own</option>
            {pedals.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {boundId !== null && !profile && (
              <option value={boundId}>{`${bound?.profileName ?? boundId} (not in SmartControl)`}</option>
            )}
          </select>
          <span className="says">
            {says}
            <span className={`pedal-note ${busy ? "" : (note?.kind ?? "")}`} role="status">
              {busy ? "saving…" : (note?.text ?? "")}
            </span>
          </span>
        </div>
      ) : (
        // What a car was given before is still the host's to show; there is nothing to choose from.
        (boundId !== null || says) && (
          <div className="pedals-line">
            {boundId !== null && <span className="kept">{bound?.profileName ?? boundId}</span>}
            <span className="says">{says}</span>
          </div>
        )
      )}
      {rig.pedalsNote && <div className="note">{rig.pedalsNote}</div>}
      {pedals.found && carPath === null && <div className="note">{rig.carsNote ?? NO_PATH}</div>}
      {pedals.keys.length > 0 && (
        <div className="live-keys">
          <span className="label">SmartControl Live keys</span>
          {pedals.keys.map((key, i) => {
            const { keys, does } = keyWords(key);
            return (
              <span className="key" key={i}>
                <b>{keys}</b> — {does}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
