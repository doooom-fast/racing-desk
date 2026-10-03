import type { ReactNode } from "react";
import { ago, millimetres, plain, signedPlain, when, type CarRestore, type CarView, type Rig } from "../rig";

const DASH = "—";
const NOT_HERE = "A car's view is kept by the Racing Desk app, and this page is running without it.";
const READING = "Reading what the host has…";
const NO_VIEW = "Not recorded yet — it will be after the next time you drive it.";

function Fact({ label, words = false, children }: { label: string; words?: boolean; children: ReactNode }) {
  return (
    <div className={words ? "fact words" : "fact"}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function mm(metres: number | null): ReactNode {
  if (metres === null) return DASH;
  return (
    <>
      {millimetres(metres)}
      <span className="unit"> mm</span>
    </>
  );
}

/// Whose the view is, and when it was recorded, in a sentence or two.
function whose(view: CarView): string {
  const parts: string[] = [];
  if (view.chosen !== null) {
    parts.push(
      view.chosen
        ? "Changed while in this car."
        : "Carried over from the car driven before it, and not changed in this one.",
    );
  }
  const recorded = when(view.seenAt);
  if (recorded) parts.push(`Recorded ${recorded}.`);
  return parts.join(" ");
}

/// The view a car was last driven with: iRacing keeps one driver height and one horizon for every car, so the
/// host records them per car when the sim closes. Seat offsets are signed millimetres, and which way a sign points is
/// not said: that has not been verified. Under it, where there is something he needs to know of putting the seat height
/// back in this car (it has no camera file, and how to save one; or one Racing Desk cannot write), the host's sentence.
/// The panel itself changes nothing of iRacing's.
export function CarViewPanel({
  here,
  rig,
  view,
  lastDriven,
  restore = null,
}: {
  /// Whether there is an app to have asked.
  here: boolean;
  /// What the host answered; null while the first answer is on its way.
  rig: Rig | null;
  view: CarView | null;
  /// The start of the latest session driven in the car, when the desk has said.
  lastDriven: string | null;
  /// What putting the cars back says of this one; null where there is nothing (no app, a host from before it).
  restore?: CarRestore | null;
}) {
  if (!here || rig === null) {
    return (
      <div className="panel car-view">
        <h3>View</h3>
        <div className="note">{here ? READING : NOT_HERE}</div>
      </div>
    );
  }

  const said = rig.views === null ? rig.viewsNote : view ? whose(view) : NO_VIEW;
  return (
    <div className="panel car-view">
      <h3>View</h3>
      <dl className="facts">
        <Fact label="Last driven" words>
          {lastDriven ? ago(lastDriven) : DASH}
        </Fact>
        {view && (
          <>
            <Fact label="Height">{mm(view.height)}</Fact>
            <Fact label="Horizon">{view.horizon === null ? DASH : signedPlain(view.horizon)}</Fact>
            <Fact label="Head horizon">{view.headHorizon === null ? DASH : plain(view.headHorizon)}</Fact>
            <Fact label="FOV">
              {view.fov === null ? (
                DASH
              ) : (
                <>
                  {plain(view.fov)}
                  <span className="unit">°</span>
                </>
              )}
            </Fact>
            <Fact label="Seat fore/aft">{mm(view.seatX)}</Fact>
            <Fact label="Seat sideways">{mm(view.seatY)}</Fact>
            <Fact label="Seat up/down">{mm(view.seatZ)}</Fact>
            <Fact label="The view is" words>
              {view.chosen === null ? DASH : view.chosen ? "its own" : "inherited"}
            </Fact>
          </>
        )}
      </dl>
      {said && <div className="note">{said}</div>}
      {restore?.view && (
        <div className="note restore-line" data-restore={restore.viewState ?? ""}>
          {restore.view}
        </div>
      )}
    </div>
  );
}
