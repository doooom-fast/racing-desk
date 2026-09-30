import { carLabel } from "./CarList";
import type { CatalogueCar, GroupCar, GroupReport, LiveryGroup } from "../types";

/// Where a car's paint would go when the group is set, or why it cannot.
function standing(entry: GroupCar, car: CatalogueCar | undefined): { text: string; settable: boolean } {
  if (entry.missing || !car) return { text: "no longer in the library", settable: false };
  if (car.simFolder) return { text: "", settable: true };
  if (car.installPath) return { text: "no paint folder yet — one is made", settable: true };
  return { text: "not in the sim", settable: false };
}

const OUTCOME: Record<string, string> = {
  applied: "applied",
  already: "already on",
  skipped: "skipped",
  failed: "failed",
};

/// One group: the cars it covers and the version each would wear, and the one button that sets them all.
export function GroupPage({
  group,
  cars,
  busy,
  ready,
  report,
  onSet,
  onEdit,
  onDelete,
  onSelectCar,
}: {
  group: LiveryGroup;
  /// Every car the rig knows, to name the group's cars and to say which it leaves out.
  cars: CatalogueCar[];
  busy: boolean;
  /// The folders and the customer id are there to apply with.
  ready: boolean;
  /// What the last setting of this group did, car by car.
  report: GroupReport | null;
  onSet: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSelectCar: (folder: string) => void;
}) {
  const byFolder = new Map(cars.map((c) => [c.folder, c]));
  const rows = group.cars
    .map((entry) => ({ entry, car: byFolder.get(entry.folder) }))
    .sort((a, b) =>
      (a.car ? carLabel(a.car) : a.entry.folder).localeCompare(
        b.car ? carLabel(b.car) : b.entry.folder,
        undefined,
        { sensitivity: "base", numeric: true },
      ),
    );
  const settable = rows.filter((r) => standing(r.entry, r.car).settable).length;

  const inGroup = new Set(group.cars.map((c) => c.folder));
  const painted = cars.filter((c) => c.versions.length > 0);
  const leftOut = painted.filter((c) => !inGroup.has(c.folder));
  const unpainted = cars.filter((c) => c.versions.length === 0 && c.installed).length;

  const results = new Map((report?.results ?? []).map((r) => [r.folder, r]));

  return (
    <>
      <div className="car-head group-head">
        <h2>{group.name}</h2>
        <div className="note">
          {group.kind === "library"
            ? `Every car with a version called ${group.name} in the library`
            : "A group of yours"}
          {" · "}
          {group.cars.length} car{group.cars.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="group-actions">
        <button
          className="primary"
          disabled={busy || !ready || settable === 0}
          onClick={onSet}
          title={ready ? "" : "The paint folder, the library and the customer id are needed first"}
        >
          Set on {settable} car{settable === 1 ? "" : "s"}
        </button>
        {group.kind === "mine" && (
          <>
            <button disabled={busy} onClick={onEdit}>
              Change
            </button>
            <button disabled={busy} onClick={onDelete}>
              Forget this group
            </button>
          </>
        )}
        <span className="note">A car already wearing its version is left as it is.</span>
      </div>

      <div className="panel">
        <h3>Cars in this group</h3>
        <table className="group-cars">
          <tbody>
            {rows.map(({ entry, car }) => {
              const s = standing(entry, car);
              const result = results.get(entry.folder);
              return (
                <tr key={entry.folder} className={s.settable ? "" : "unsettable"}>
                  <td className="name">
                    {car ? (
                      <button className="link" onClick={() => onSelectCar(entry.folder)}>
                        {carLabel(car)}
                      </button>
                    ) : (
                      <span className="mono">{entry.folder}</span>
                    )}
                  </td>
                  <td className="version">{entry.versionName}</td>
                  <td className="standing note">{s.text}</td>
                  <td className={`outcome ${result?.outcome ?? ""}`} title={result?.detail ?? ""}>
                    {result ? OUTCOME[result.outcome] ?? result.outcome : ""}
                    {result && (result.outcome === "skipped" || result.outcome === "failed") && (
                      <span className="note"> — {result.detail}</span>
                    )}
                    {result?.outcome === "applied" && result.helmet?.onCar && (
                      <span className="note"> — with the {result.helmet.set} helmet</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* Which helmet the group made the default, or why the default was left as it was. */}
        {report?.helmet?.said && <div className="note helmet-said">{report.helmet.said}</div>}
      </div>

      {(leftOut.length > 0 || unpainted > 0) && (
        <div className="panel">
          <h3>Not in this group</h3>
          {leftOut.length > 0 && (
            <div>
              {group.kind === "library"
                ? `No version called ${group.name} for `
                : "Left out: "}
              {leftOut.map((c, i) => (
                <span key={c.folder}>
                  {i > 0 && ", "}
                  <button className="link" onClick={() => onSelectCar(c.folder)}>
                    {carLabel(c)}
                  </button>
                </span>
              ))}
              .
            </div>
          )}
          {unpainted > 0 && (
            <div className="note">
              {unpainted} more car{unpainted === 1 ? "" : "s"} on the rig {unpainted === 1 ? "has" : "have"} no
              livery in the library at all. A car joins{" "}
              {group.kind === "library" ? "this group" : "the library"} when a version for it is put
              there.
            </div>
          )}
        </div>
      )}
    </>
  );
}
