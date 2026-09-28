import { useMemo, useState } from "react";
import { carLabel } from "./CarList";
import type { CatalogueCar, LiveryGroup } from "../types";

/// Making a group, or changing one: its name, and for each car that has a livery the version it wears
/// in this group — or none, which leaves the car out.
export function GroupEditor({
  group,
  cars,
  busy,
  error,
  onSave,
  onCancel,
}: {
  /// The group being changed; null for a new one.
  group: LiveryGroup | null;
  cars: CatalogueCar[];
  busy: boolean;
  /// Why the last save was refused.
  error: string | null;
  onSave: (name: string, cars: Record<string, string | null>) => void;
  onCancel: () => void;
}) {
  const painted = useMemo(
    () =>
      cars
        .filter((c) => c.versions.length > 0)
        .sort((a, b) =>
          carLabel(a).localeCompare(carLabel(b), undefined, { sensitivity: "base", numeric: true }),
        ),
    [cars],
  );

  const [name, setName] = useState(group?.name ?? "");
  const [chosen, setChosen] = useState<Record<string, string>>(() => {
    const start: Record<string, string> = {};
    for (const c of group?.cars ?? []) if (!c.missing) start[c.folder] = c.versionId;
    return start;
  });

  /// Version names more than one car has, most cars first: what "every car in…" can offer.
  const common = useMemo(() => {
    const count = new Map<string, { name: string; cars: number }>();
    for (const car of painted) {
      for (const v of car.versions) {
        const key = v.id.toLowerCase();
        const seen = count.get(key);
        if (seen) seen.cars += 1;
        else count.set(key, { name: v.id, cars: 1 });
      }
    }
    return [...count.entries()]
      .filter(([, v]) => v.cars > 1)
      .sort((a, b) => b[1].cars - a[1].cars || a[1].name.localeCompare(b[1].name));
  }, [painted]);

  /// Every car that has the version wears it; a car that has not keeps what it had.
  const fill = (key: string) => {
    if (!key) return;
    setChosen((current) => {
      const next = { ...current };
      for (const car of painted) {
        const v = car.versions.find((x) => x.id.toLowerCase() === key);
        if (v) next[car.folder] = v.id;
      }
      return next;
    });
  };

  const count = painted.filter((c) => chosen[c.folder]).length;
  const valid = name.trim().length > 0 && name.trim().length <= 60 && count > 0;

  const save = () => {
    const out: Record<string, string | null> = {};
    for (const car of painted) out[car.folder] = chosen[car.folder] || null;
    onSave(name.trim(), out);
  };

  return (
    <>
      <div className="car-head group-head">
        <h2>{group ? `Change ${group.name}` : "New group"}</h2>
        <div className="note">
          A name, and the version each car wears. Setting the group puts them all on in one go.
        </div>
      </div>

      <div className="panel group-editor">
        <div className="row-line">
          <label className="label" htmlFor="group-name">
            Name
          </label>
          <input
            id="group-name"
            type="text"
            value={name}
            maxLength={60}
            spellCheck={false}
            placeholder="Race day"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {common.length > 0 && (
          <div className="row-line">
            <label className="label" htmlFor="group-fill">
              Every car in
            </label>
            <select id="group-fill" value="" onChange={(e) => fill(e.target.value)}>
              <option value="">choose a version…</option>
              {common.map(([key, v]) => (
                <option key={key} value={key}>
                  {v.name} ({v.cars} cars)
                </option>
              ))}
            </select>
            <button onClick={() => setChosen({})} disabled={count === 0}>
              Clear
            </button>
          </div>
        )}

        <table className="group-cars">
          <tbody>
            {painted.map((car) => (
              <tr key={car.folder} className={chosen[car.folder] ? "" : "unsettable"}>
                <td className="name">
                  <label htmlFor={`group-car-${encodeURIComponent(car.folder)}`}>{carLabel(car)}</label>
                </td>
                <td className="version">
                  <select
                    id={`group-car-${encodeURIComponent(car.folder)}`}
                    value={chosen[car.folder] ?? ""}
                    onChange={(e) =>
                      setChosen((current) => {
                        const next = { ...current };
                        if (e.target.value) next[car.folder] = e.target.value;
                        else delete next[car.folder];
                        return next;
                      })
                    }
                  >
                    <option value="">not in this group</option>
                    {car.versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {error && (
          <div className="banner bad" role="alert">
            <span className="mark">!</span>
            <div>{error}</div>
          </div>
        )}

        <div className="group-actions">
          <button className="primary" disabled={busy || !valid} onClick={save}>
            {group ? "Save" : "Make the group"}
          </button>
          <button onClick={onCancel}>Cancel</button>
          <span className="note">
            {count} car{count === 1 ? "" : "s"} in it
          </span>
        </div>
      </div>
    </>
  );
}
