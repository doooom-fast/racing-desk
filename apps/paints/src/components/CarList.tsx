import { useEffect, useMemo, useRef, useState } from "react";
import { ago, rigKey } from "../rig";
import type { CatalogueCar, LiveryGroup } from "../types";

/// The cars the host keeps something for, by key (rig.ts): a view, pedals. They are marked in the list, so
/// that the cars that have been set up can be found among all the rest.
export interface Kept {
  view: ReadonlySet<string>;
  pedals: ReadonlySet<string>;
}

const NOTHING_KEPT: Kept = { view: new Set(), pedals: new Set() };
const NEVER: ReadonlyMap<string, string> = new Map();

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

/// Whether the driver has driven the car: the desk has a session of his in it, or the store counts one.
export const isDriven = (car: CatalogueCar, lastDriven: ReadonlyMap<string, string>): boolean =>
  car.driven > 0 || lastDriven.has(rigKey(car));

/// The cars he has driven, the last driven first. One the store counts sessions for and the desk has no date
/// for comes after those with one, by name.
export function drivenCars(
  cars: CatalogueCar[],
  lastDriven: ReadonlyMap<string, string>,
): CatalogueCar[] {
  const at = (car: CatalogueCar) => Date.parse(lastDriven.get(rigKey(car)) ?? "") || 0;
  return cars.filter((c) => isDriven(c, lastDriven)).sort((a, b) => at(b) - at(a) || byLabel(a, b));
}

/// The car the page opens on until one is chosen: the one driven last, or, while the desk has said nothing
/// of any car in the list, the first as the list shows them.
export function carToOpenOn(
  cars: CatalogueCar[],
  lastDriven: ReadonlyMap<string, string>,
): CatalogueCar | null {
  const last = drivenCars(cars, lastDriven)[0];
  if (last && lastDriven.has(rigKey(last))) return last;
  const { liveries, rest } = groupCars(cars);
  return liveries[0] ?? rest[0] ?? null;
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
function metaFor(car: CatalogueCar, ambiguous: boolean, drove: string | null = null): string {
  const parts: string[] = [];
  if (drove) parts.push(drove);
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
  kept,
  selected,
  onSelect,
  quiet = false,
  lastDriven = null,
}: {
  title: string;
  cars: CatalogueCar[];
  shared: Set<string>;
  kept: Kept;
  selected: string | null;
  onSelect: (folder: string) => void;
  /// The cars with nothing to apply. Said, not worked out from where the group is in the list: the
  /// filter can leave either group the only one.
  quiet?: boolean;
  /// For the cars he has driven: when each was, which its row then says first.
  lastDriven?: ReadonlyMap<string, string> | null;
}) {
  if (cars.length === 0) return null;
  const drove = (c: CatalogueCar) => {
    if (!lastDriven) return null;
    const last = lastDriven.get(rigKey(c));
    return last ? `driven ${ago(last)}` : `driven in ${c.driven} session${c.driven === 1 ? "" : "s"}`;
  };
  return (
    <div className={quiet ? "group rest" : "group"} role="group" aria-label={title}>
      <div className="heading">
        {title} <span className="count">{cars.length}</span>
      </div>
      {cars.map((c) => {
        const meta = metaFor(c, shared.has(carLabel(c).toLowerCase()), drove(c));
        const view = kept.view.has(rigKey(c));
        const pedals = kept.pedals.has(rigKey(c));
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
            {/* Words inside the row, not controls of their own: a row stays one stop for the keyboard. */}
            {(view || pedals) && (
              <span className="kept">
                {view && (
                  <span className="mark" title="The view it was driven with is recorded">
                    view
                  </span>
                )}
                {pedals && (
                  <span className="mark" title="Its pedals are kept">
                    pedals
                  </span>
                )}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/// The groups, above the cars: each sets a livery on every car in it.
function Groups({
  groups,
  selected,
  onSelect,
  onNew,
}: {
  groups: LiveryGroup[];
  selected: string | null;
  onSelect: (id: string) => void;
  onNew: (() => void) | null;
}) {
  if (groups.length === 0 && !onNew) return null;
  return (
    <div className="groups" role="group" aria-label="Groups">
      <div className="heading">
        Groups <span className="count">{groups.length}</span>
        {onNew && (
          <button className="link new" onClick={onNew}>
            New
          </button>
        )}
      </div>
      {groups.map((g) => (
        <button
          key={g.id}
          className={`car livery-group ${g.id === selected ? "active" : ""}`}
          aria-current={g.id === selected ? "true" : undefined}
          onClick={() => onSelect(g.id)}
        >
          <span className="name">{g.name}</span>
          <span className="meta">
            {g.cars.length} car{g.cars.length === 1 ? "" : "s"}
            {g.kind === "mine" ? " · yours" : ""}
          </span>
        </button>
      ))}
    </div>
  );
}

/// The sidebar: the livery groups, then every car the rig knows, the ones with a livery first, and a
/// filter over the cars. It is the one list of cars: a car's liveries, its view and its pedals are all
/// looked at from here.
///
/// "Driven" narrows it to the cars he has driven, the last driven first, which is how the car he has just got
/// out of is found among a couple of hundred. That list is one group and not the two: newest first is an
/// order across every car driven, and under "Liveries" and "No livery yet" a car just driven that has no
/// livery would be below every driven car that has one. Off, the list is as it was, with every car in it.
export function CarList({
  cars,
  selected,
  onSelect,
  empty,
  kept = NOTHING_KEPT,
  lastDriven = NEVER,
  groups = [],
  selectedGroup = null,
  onSelectGroup = () => {},
  onNewGroup = null,
}: {
  cars: CatalogueCar[];
  /// The car being looked at; none while a group is.
  selected: string | null;
  onSelect: (folder: string) => void;
  /// What to say when there are no cars at all.
  empty: string;
  kept?: Kept;
  /// When each car was last driven, by key (rig.ts), as the desk has said.
  lastDriven?: ReadonlyMap<string, string>;
  groups?: LiveryGroup[];
  selectedGroup?: string | null;
  onSelectGroup?: (id: string) => void;
  /// Null where groups cannot be made: outside the desk, or with no livery to make one of.
  onNewGroup?: (() => void) | null;
}) {
  const [filter, setFilter] = useState("");
  /// Only the cars he has driven. Kept while the page is open, as the filter's text is.
  const [drivenOnly, setDrivenOnly] = useState(false);
  const query = fold(filter).trim().replace(/\s+/g, " ");
  const list = useRef<HTMLDivElement>(null);

  // The car being looked at stays in sight: a filter cleared, or a refresh that chose another car, would
  // leave the list at its top and the car thousands of pixels down. Not while a filter is typed — what
  // it finds starts at the top.
  useEffect(() => {
    if (query) return;
    list.current?.querySelector(".car.active")?.scrollIntoView({ block: "nearest" });
  }, [query, selected, drivenOnly]);

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

  const found = useMemo(() => {
    const words = query ? query.split(" ") : [];
    return words.length ? cars.filter((c) => matches(c, words)) : cars;
  }, [cars, query]);
  const { liveries, rest } = useMemo(() => groupCars(drivenOnly ? [] : found), [found, drivenOnly]);
  const driven = useMemo(
    () => (drivenOnly ? drivenCars(found, lastDriven) : []),
    [found, drivenOnly, lastDriven],
  );
  const anyDriven = useMemo(() => cars.some((c) => isDriven(c, lastDriven)), [cars, lastDriven]);

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
        {/* There while there is a car to find with it, and while it is on: it is the way back out. */}
        {(anyDriven || drivenOnly) && (
          <button
            type="button"
            className={drivenOnly ? "driven on" : "driven"}
            aria-pressed={drivenOnly}
            title="Only the cars you have driven, the last driven first"
            onClick={() => setDrivenOnly((on) => !on)}
          >
            Driven
          </button>
        )}
      </div>
      <div className="list" ref={list}>
        {!query && !drivenOnly && (
          <Groups
            groups={groups}
            selected={selectedGroup}
            onSelect={onSelectGroup}
            onNew={onNewGroup}
          />
        )}
        <Group
          title="Liveries"
          cars={liveries}
          shared={shared}
          kept={kept}
          selected={selected}
          onSelect={onSelect}
        />
        <Group
          title="No livery yet"
          cars={rest}
          shared={shared}
          kept={kept}
          selected={selected}
          onSelect={onSelect}
          quiet
        />
        <Group
          title="Driven"
          cars={driven}
          shared={shared}
          kept={kept}
          selected={selected}
          onSelect={onSelect}
          lastDriven={lastDriven}
        />
        {liveries.length + rest.length + driven.length === 0 && (
          <div className="empty">
            {!query
              ? "No car here has been driven yet."
              : drivenOnly
                ? `No car you have driven matches “${filter.trim()}”.`
                : `No car matches “${filter.trim()}”.`}
          </div>
        )}
      </div>
    </div>
  );
}
