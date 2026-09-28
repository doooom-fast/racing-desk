import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogueCar } from "../types";

/// What a car is called on screen: the sim's name for it, or its folder when it has none.
export function carLabel(car: CatalogueCar): string {
  return car.name || car.folder;
}

const byLabel = (a: CatalogueCar, b: CatalogueCar) =>
  carLabel(a).localeCompare(carLabel(b), undefined, { sensitivity: "base", numeric: true }) ||
  a.folder.localeCompare(b.folder);

/// The cars with a livery first, then the rest, each by name.
export function groupCars(cars: CatalogueCar[]): { liveries: CatalogueCar[]; rest: CatalogueCar[] } {
  return {
    liveries: cars.filter((c) => c.versions.length > 0).sort(byLabel),
    rest: cars.filter((c) => c.versions.length === 0).sort(byLabel),
  };
}

/// Case and accents folded away, as the list's order already takes them: "huracan" is "Huracán".
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/// Every word typed has to be somewhere in the car's names or folders, in whatever order:
/// "mazda cup" is the Mazda MX-5 Cup.
function matches(car: CatalogueCar, words: string[]): boolean {
  const texts = [car.name, car.shortName, car.folder, car.simFolder]
    .filter((text): text is string => !!text)
    .map(fold);
  return words.every((word) => texts.some((text) => text.includes(word)));
}

/// The line under a car's name, or nothing. The name says which car it is; the folder is only worth the
/// room where it says something more — the library calls the car one thing and the sim another, or two
/// cars in the list go by the same name.
function metaFor(car: CatalogueCar, ambiguous: boolean): string {
  const parts: string[] = [];
  const n = car.versions.length;
  if (n > 0) parts.push(`${n} version${n === 1 ? "" : "s"}`);
  const renamed = car.simFolder !== null && car.simFolder !== car.folder;
  if (car.name && (renamed || ambiguous)) parts.push(car.folder);
  if (renamed) parts.push(`installs to ${car.simFolder}`);
  if (n > 0 && !car.simFolder) parts.push(car.installed ? "no paint folder yet" : "not in the sim");
  if (n === 0 && !car.installed) parts.push("not installed");
  return parts.join(" · ");
}

function Group({
  title,
  cars,
  shared,
  selected,
  onSelect,
  quiet = false,
}: {
  title: string;
  cars: CatalogueCar[];
  shared: Set<string>;
  selected: string | null;
  onSelect: (folder: string) => void;
  /// The cars with nothing to apply. Said, not worked out from where the group is in the list: the
  /// filter can leave either group the only one.
  quiet?: boolean;
}) {
  if (cars.length === 0) return null;
  return (
    <div className={quiet ? "group rest" : "group"} role="group" aria-label={title}>
      <div className="heading">
        {title} <span className="count">{cars.length}</span>
      </div>
      {cars.map((c) => {
        const meta = metaFor(c, shared.has(carLabel(c).toLowerCase()));
        return (
          <button
            key={c.folder}
            className={`car ${c.folder === selected ? "active" : ""}`}
            aria-current={c.folder === selected ? "true" : undefined}
            title={c.folder}
            onClick={() => onSelect(c.folder)}
          >
            <span className="name">{carLabel(c)}</span>
            {meta && <span className="meta">{meta}</span>}
          </button>
        );
      })}
    </div>
  );
}

/// The sidebar: every car the rig knows, the ones with a livery first, and a filter over both.
export function CarList({
  cars,
  selected,
  onSelect,
  empty,
}: {
  cars: CatalogueCar[];
  selected: string | null;
  onSelect: (folder: string) => void;
  /// What to say when there are no cars at all.
  empty: string;
}) {
  const [filter, setFilter] = useState("");
  const query = fold(filter).trim().replace(/\s+/g, " ");
  const list = useRef<HTMLDivElement>(null);

  // The car being looked at stays in sight: a filter cleared, or a refresh that chose another car, would
  // leave the list at its top and the car thousands of pixels down. Not while a filter is typed — what
  // it finds starts at the top.
  useEffect(() => {
    if (query) return;
    list.current?.querySelector(".car.active")?.scrollIntoView({ block: "nearest" });
  }, [query, selected]);

  const shared = useMemo(() => {
    const seen = new Set<string>();
    const twice = new Set<string>();
    for (const c of cars) {
      const label = carLabel(c).toLowerCase();
      if (seen.has(label)) twice.add(label);
      seen.add(label);
    }
    return twice;
  }, [cars]);

  const { liveries, rest } = useMemo(() => {
    const words = query ? query.split(" ") : [];
    return groupCars(words.length ? cars.filter((c) => matches(c, words)) : cars);
  }, [cars, query]);

  if (cars.length === 0) {
    return (
      <div className="sidebar">
        <div className="empty">{empty}</div>
      </div>
    );
  }

  return (
    <div className="sidebar">
      <div className="filter">
        <input
          type="text"
          value={filter}
          placeholder="Filter cars"
          aria-label="Filter cars by name or folder"
          spellCheck={false}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && filter) {
              e.stopPropagation();
              setFilter("");
            }
          }}
        />
      </div>
      <div className="list" ref={list}>
        <Group
          title="Liveries"
          cars={liveries}
          shared={shared}
          selected={selected}
          onSelect={onSelect}
        />
        <Group
          title="No livery yet"
          cars={rest}
          shared={shared}
          selected={selected}
          onSelect={onSelect}
          quiet
        />
        {liveries.length + rest.length === 0 && (
          <div className="empty">No car matches “{filter.trim()}”.</div>
        )}
      </div>
    </div>
  );
}
