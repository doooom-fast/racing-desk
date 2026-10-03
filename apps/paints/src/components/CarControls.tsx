import type { ReactNode } from "react";
import {
  UNKNOWN_CAR,
  controlLine,
  kindWords,
  labelBeside,
  labelFor,
  wordsFor,
  seenWords,
  sentence,
  valueWords,
  type Having,
  type ListedCar,
  type Remark,
  type Rig,
} from "../rig";

const DASH = "—";
const NOT_LISTED =
  "This car is not in the car list. The HUD shows its controls as it did before there was a list.";
const NO_CONTROLS = "The list gives this car no controls.";
const UNREAD = "What the check has found could not be read from the host's store.";

const CHECKED = new Map([
  ["telemetry", "Checked against your telemetry."],
  ["written", "Written from the manuals; not checked against your telemetry yet."],
]);

function Fact({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="fact words" title={title}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/// The car's own label for a dial, as its dash shows it, with the words for it as its title (TCLO is "Traction slip" on
/// hovering): an abbreviation always has them to hover on.
const tag = (label: string, words: string) => (
  <span className="tag" title={words}>
    {label}
  </span>
);

/// Whether a car has one of the three, with what the car calls its dial where that says more than the line the fact is
/// under: its abbreviation, or a name of its own. The dial's generic label (ABS for the anti-lock), and a label that is the
/// line again or a part of it ("Brake bias" under Brake bias), say nothing the line does not, and are left out.
function has(value: Having | null, line: string, label: string | null, words: string | null, id: string): ReactNode {
  if (value === null) return DASH;
  if (value === "none") return "none";
  const shown = labelBeside(line, id, label) && labelBeside(words ?? line, id, label);
  const chip = shown && <> {tag(shown, words ?? line)}</>;
  return <>{value === "fixed" ? "fixed" : "adjustable"}{chip}</>;
}

const HAVING_TITLE: Record<Having, string> = {
  none: "The car has none.",
  fixed: "The car has it, and you cannot turn it.",
  adjustable: "The car has it, and you can turn it.",
};

/// What the check has found where the car and the list disagree, each as a sentence with when it was first and
/// last seen. Set apart from the rest of the panel: it is what the list's author has to act on.
function Disagreements({ remarks }: { remarks: Remark[] }) {
  return (
    <div className="disagreements" role="group" aria-label="Where the car and the list disagree">
      <div className="heading">
        Where the car and the list disagree <span className="count">{remarks.length}</span>
      </div>
      <ul>
        {remarks.map((r, i) => {
          const seen = seenWords(r);
          return (
            <li key={`${r.about}-${i}`}>
              <span className="says">{sentence(r.text)}</span>
              {seen && <span className="when">{seen}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/// What the canonical list of cars says of the car: its kind; whether it has anti-lock, traction control and a brake bias,
/// each as none, fixed or adjustable, with the car's own name for the dial; each control with its label and its
/// range or named positions; and whether the entry was checked against the driver's telemetry or written from the
/// manuals. Above it, where there are any, what the host's check has found the car doing that the list does not
/// say. A car the list does not have says so, and nothing is made up for it.
///
/// It is short on purpose. The panel sits under the view and the pedals, and the car's liveries begin under it: in
/// the desk's smallest window a listed car's liveries are still in sight, so what the list says of the car's kind and
/// its three dials is on one line, how it was checked is beside the heading, and the rows of controls — a prototype
/// has eight — are one press away. What disagrees is never folded: it is what the list's author has to act on.
///
/// Not there at all for a host from before the list, or one whose build carries none: the page is then as it was.
export function CarControlsPanel({
  rig,
  listed,
  remarks,
}: {
  /// What the host answered; null while the first answer is on its way.
  rig: Rig | null;
  /// The car's entry in the list; null for a car the list does not have.
  listed: ListedCar | null;
  /// What the check has said of the car against the list in use; null where the host could not read them.
  remarks: Remark[] | null;
}) {
  if (rig === null || (rig.list === null && rig.listNote === null)) return null;
  if (rig.list === null) {
    return (
      <div className="panel car-controls">
        <h3>Controls</h3>
        <div className="note">{rig.listNote}</div>
      </div>
    );
  }

  const differences = (remarks ?? []).filter((r) => r.about !== UNKNOWN_CAR);
  const noticed = (remarks ?? []).find((r) => r.about === UNKNOWN_CAR);
  const seen = noticed ? seenWords(noticed) : null;
  const checked = listed?.checked ? (CHECKED.get(listed.checked) ?? null) : null;

  return (
    <div className="panel car-controls">
      <div className="head">
        <h3>Controls</h3>
        {checked && <span className="note checked">{checked}</span>}
      </div>
      {differences.length > 0 && <Disagreements remarks={differences} />}
      {listed === null ? (
        <div className="not-listed">
          <div>{NOT_LISTED}</div>
          {noticed && <div className="note">The check noticed it. {seen}</div>}
        </div>
      ) : (
        <>
          <dl className="facts">
            <Fact label="Kind">{kindWords(listed.kind) ?? DASH}</Fact>
            <Fact label="Anti-lock" title={listed.abs ? HAVING_TITLE[listed.abs] : undefined}>
              {has(listed.abs, "Anti-lock", labelFor(listed, "abs"), wordsFor(listed, "abs"), "abs")}
            </Fact>
            <Fact label="Traction control" title={listed.tc ? HAVING_TITLE[listed.tc] : undefined}>
              {has(listed.tc, "Traction control", labelFor(listed, "tc"), wordsFor(listed, "tc"), "tc")}
            </Fact>
            <Fact label="Brake bias" title={listed.brakeBias ? HAVING_TITLE[listed.brakeBias] : undefined}>
              {has(listed.brakeBias, "Brake bias", labelFor(listed, "brakeBias"), wordsFor(listed, "brakeBias"), "brakeBias")}
            </Fact>
          </dl>
          {listed.controls.length > 0 ? (
            <details className="control-rows">
              <summary>
                Each control, its label and values <span className="count">{listed.controls.length}</span>
              </summary>
              <ul className="controls" aria-label="Controls the list gives this car">
                {listed.controls.map((c, i) => {
                  // The words, else the car's own label where that is words, else what the control is for; the label
                  // beside it only where it says more (an abbreviation, a name of its own), never the same twice.
                  const line = controlLine(c);
                  const own = labelBeside(line, c.id, c.label);
                  return (
                    <li key={`${c.id}-${i}`} title={c.variable ?? undefined}>
                      <span className="what">{line}</span>
                      {own && <> {tag(own, line)}</>}
                      {valueWords(c) && <> <span className="values">{valueWords(c)}</span></>}
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : (
            <div className="note">{NO_CONTROLS}</div>
          )}
        </>
      )}
      {remarks === null && <div className="note">{UNREAD}</div>}
    </div>
  );
}
