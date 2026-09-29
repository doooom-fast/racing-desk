import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as api from "./api";
import { inDesk, reveal } from "./bridge";
import { errorText } from "./api";
import { ApplyOptionsPanel, Refusal, type ApplyOptions } from "./components/ApplyOptions";
import { CarList, carLabel, groupCars, type Kept } from "./components/CarList";
import { CarPedalsPanel } from "./components/CarPedals";
import { CarViewPanel } from "./components/CarView";
import { GroupEditor } from "./components/GroupEditor";
import { GroupPage } from "./components/GroupPage";
import { TradingPaintsPanel } from "./components/Guards";
import { RepoPanel } from "./components/RepoPanel";
import { SetupBar } from "./components/SetupBar";
import { collectStatus, StatusChips } from "./components/StatusChips";
import { VersionCard } from "./components/VersionCard";
import { useLastDriven } from "./driven";
import { hasPedals, rigKey } from "./rig";
import { useRig } from "./useRig";
import type {
  BackupEntry,
  CatalogueCar,
  CustomerReport,
  GroupReport,
  InstalledState,
  LibrarySuggestion,
  LiveryGroup,
  PathReport,
  RepoStatus,
  Settings,
  SimState,
  TradingPaints,
  Version,
} from "./types";

interface LogEntry {
  id: number;
  when: string;
  kind: "ok" | "bad" | "info";
  title: string;
  lines: string[];
}

/// An apply that was refused: what was asked for, why not, and whether going on regardless is on offer.
type Refused =
  | { what: "version"; carFolder: string; version: Version; reason: string; canForce: boolean }
  | { what: "group"; groupId: string; reason: string; canForce: boolean };

/// Where a new version of a car goes, for showing: `<library>\<car folder>\<version name>\`. Nothing is
/// made of it but text — the folders are the user's to create.
function versionHome(libraryRoot: string, folder: string): string {
  return `${libraryRoot.replace(/[\\/]+$/, "")}\\${folder}\\<version name>\\`;
}

/// How often the guards re-check. The downloader can be started while the app is open, and a
/// status chip that went stale would be worse than none.
const GUARD_POLL_MS = 8000;

export default function App() {
  const [paintDir, setPaintDir] = useState("");
  const [libraryRoot, setLibraryRoot] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [options, setOptions] = useState<ApplyOptions>({
    includeSpec: true,
    setReadOnlyAfter: false,
    clearOtherCooked: false,
  });

  const [pathReport, setPathReport] = useState<PathReport | null>(null);
  const [customerReport, setCustomerReport] = useState<CustomerReport | null>(null);
  const [cars, setCars] = useState<CatalogueCar[] | null>(null);
  /// Where the list of cars stands. No cars is only "there are none" once the list is here.
  const [listing, setListing] = useState<"reading" | "read" | "failed">("reading");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [installed, setInstalled] = useState<InstalledState | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [tp, setTp] = useState<TradingPaints | null>(null);
  const [sim, setSim] = useState<SimState | null>(null);
  const [suggestions, setSuggestions] = useState<LibrarySuggestion[]>([]);
  /// Whether a library has been looked for. Until it has, an empty field is not yet "there is no library".
  const [looked, setLooked] = useState(false);
  const [repo, setRepo] = useState<RepoStatus | null>(null);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [checking, setChecking] = useState(false);

  const [groups, setGroups] = useState<LiveryGroup[]>([]);
  /// The group on the page, in place of a car.
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  /// A group being made (`group` null) or changed, in place of either.
  const [editing, setEditing] = useState<{ group: LiveryGroup | null } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [groupReport, setGroupReport] = useState<GroupReport | null>(null);

  const [refused, setRefused] = useState<Refused | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logId = useRef(0);
  const ready = useRef(false);

  // What the host keeps per car beside its paint — the view it was driven with, its pedals — and when the
  // desk says each was last driven. The desk's alone: elsewhere the two panels say there is no app.
  const rig = useRig();
  const lastDriven = useLastDriven();

  const say = useCallback((kind: LogEntry["kind"], title: string, lines: string[] = []) => {
    logId.current += 1;
    setLog((prev) =>
      [
        {
          id: logId.current,
          when: new Date().toLocaleTimeString(),
          kind,
          title,
          lines,
        },
        ...prev,
      ].slice(0, 40),
    );
  }, []);

  // --- start up: remembered settings first, detection to fill the gaps ------------------
  useEffect(() => {
    (async () => {
      const [saved, detected] = await Promise.all([
        api.loadSettings().catch((): Settings => ({})),
        api.detectPaths().catch(() => null),
      ]);
      setPathReport(detected);
      const paint = saved.paintDir || detected?.chosen || "";
      setPaintDir(paint);
      setLibraryRoot(saved.libraryRoot ?? "");
      if (saved.customerId) setCustomerId(saved.customerId);
      setOptions({
        includeSpec: saved.includeSpec ?? true,
        setReadOnlyAfter: saved.setReadOnlyAfter ?? false,
        clearOtherCooked: saved.clearOtherCooked ?? false,
      });
      setAutoUpdate(saved.autoUpdateOnLaunch ?? false);
      for (const note of detected?.notes ?? []) say("info", note);
      // With no paint folder there is nowhere to look for a library near.
      if (!paint) setLooked(true);
      ready.current = true;
    })();
  }, [say]);

  // --- find a library near the sim, so the common case needs no browsing ---------------
  useEffect(() => {
    if (!paintDir) return;
    let live = true;
    api
      .suggestLibraries(paintDir)
      .then((found) => {
        if (!live) return;
        setSuggestions(found);
        // Adopt the best one only when nothing is set; a chosen path is the user's.
        setLibraryRoot((current) => current || found[0]?.path || "");
        setLooked(true);
      })
      .catch(() => live && setLooked(true));
    return () => {
      live = false;
    };
  }, [paintDir]);

  // --- persist, once the initial load has settled --------------------------------------
  useEffect(() => {
    if (!ready.current) return;
    const t = setTimeout(() => {
      api
        .saveSettings({
          paintDir: paintDir || null,
          libraryRoot: libraryRoot || null,
          customerId: customerId || null,
          includeSpec: options.includeSpec,
          setReadOnlyAfter: options.setReadOnlyAfter,
          clearOtherCooked: options.clearOtherCooked,
          autoUpdateOnLaunch: autoUpdate,
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [paintDir, libraryRoot, customerId, options, autoUpdate]);

  // --- customer id detection ------------------------------------------------------------
  useEffect(() => {
    if (!paintDir) return;
    let live = true;
    api
      .detectCustomer(paintDir)
      .then((r) => {
        if (!live) return;
        setCustomerReport(r);
        // Only fill an empty field: a value the user typed is theirs.
        setCustomerId((current) => current || r.id || "");
      })
      .catch((e) => live && say("bad", "Could not read the paint folder", [errorText(e)]));
    return () => {
      live = false;
    };
  }, [paintDir, say]);

  // --- the cars: the library's, and every other car the rig knows ------------------------
  // Each answer is numbered, because the folders can change while one is on its way — every keystroke in
  // a path asks again — and the list has to be the last one asked for, not the last one to arrive. The
  // groups are read with the cars: they are made of the same library.
  //
  // In the desk the list does not wait on a library: a car's view and pedals are there to be looked at
  // whether or not there is a livery anywhere, so once a library has been looked for and none found, the
  // cars are the install's and the paint folder's. The Tauri shell lists a library or nothing.
  const asked = useRef(0);
  const listable = !!libraryRoot || (inDesk() && looked);
  const refreshLibrary = useCallback(async () => {
    const mine = ++asked.current;
    if (!listable) {
      setCars(null);
      setGroups([]);
      return;
    }
    setListing("reading");
    try {
      const [found, grouped] = await Promise.all([
        api.carCatalogue(libraryRoot, paintDir || null),
        // Groups are a nicety: a list of cars is not held up by them, nor lost with them.
        api.liveryGroups(libraryRoot, paintDir || null).catch((): LiveryGroup[] => []),
      ]);
      if (mine !== asked.current) return;
      setCars(found);
      setGroups(grouped);
      setListing("read");
      // A car that is still there stays selected; otherwise the first with a livery, as the list shows it.
      setSelectedFolder((current) => {
        if (current && found.some((c) => c.folder === current)) return current;
        const { liveries, rest } = groupCars(found);
        return (liveries[0] ?? rest[0])?.folder ?? null;
      });
      setSelectedGroup((current) => (current && grouped.some((g) => g.id === current) ? current : null));
    } catch (e) {
      if (mine !== asked.current) return;
      setCars(null);
      setGroups([]);
      setListing("failed");
      say("bad", "Could not read the library", [errorText(e)]);
    }
  }, [libraryRoot, paintDir, listable, say]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  // --- the library as a git checkout ----------------------------------------------------
  const refreshRepo = useCallback(async () => {
    if (!libraryRoot) {
      setRepo(null);
      return;
    }
    try {
      setRepo(await api.repoStatus(libraryRoot));
    } catch {
      setRepo(null);
    }
  }, [libraryRoot]);

  useEffect(() => {
    void refreshRepo();
  }, [refreshRepo]);

  /// Ask the remote what it has. Read-only — it never touches the working tree.
  const checkForUpdates = useCallback(async () => {
    if (!libraryRoot) return null;
    setChecking(true);
    try {
      const status = await api.repoCheck(libraryRoot);
      setRepo(status);
      return status;
    } catch (e) {
      say("bad", "Could not reach the library repo", [errorText(e)]);
      return null;
    } finally {
      setChecking(false);
    }
  }, [libraryRoot, say]);

  const updateLibrary = useCallback(async () => {
    if (!libraryRoot) return;
    setBusy(true);
    try {
      const report = await api.repoPull(libraryRoot);
      setRepo(report.status);
      if (report.updated) {
        say(
          "ok",
          `Library updated — ${report.commits.length} new commit${
            report.commits.length === 1 ? "" : "s"
          }`,
          report.commits,
        );
        await refreshLibrary();
      } else {
        say("info", "The library is already up to date.");
      }
    } catch (e) {
      say("bad", "Could not update the library", [errorText(e)]);
    } finally {
      setBusy(false);
    }
  }, [libraryRoot, refreshLibrary, say]);

  // Check once per library on launch, and pull only if asked to.
  const checkedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready.current || !libraryRoot || checkedFor.current === libraryRoot) return;
    checkedFor.current = libraryRoot;
    (async () => {
      const status = await checkForUpdates();
      if (!status?.isRepo || !status.updatesAvailable) return;
      if (autoUpdate) {
        await updateLibrary();
      } else {
        // The count is only known when the commits are already downloaded.
        say(
          "info",
          status.behind > 0
            ? `${status.behind} library update${status.behind === 1 ? "" : "s"} waiting`
            : "New liveries are waiting in the library repo",
          ["Use Update under Library source to take them."],
        );
      }
    })();
  }, [libraryRoot, autoUpdate, checkForUpdates, updateLibrary, say]);

  const car: CatalogueCar | null = useMemo(
    () => cars?.find((c) => c.folder === selectedFolder) ?? null,
    [cars, selectedFolder],
  );
  const carName = car ? carLabel(car) : "";
  /// Where the car's paint goes: its folder in the paint directory, or, for a car never driven, the
  /// folder the sim would make for it — which an apply makes. Null for a car the sim does not have.
  const target = car ? (car.simFolder ?? car.installPath) : null;
  const group = useMemo(
    () => groups.find((g) => g.id === selectedGroup) ?? null,
    [groups, selectedGroup],
  );

  // --- installed state for the selected car ---------------------------------------------
  // Numbered like the list: what is shown is the answer for the last car asked about, however late
  // another's arrives.
  const carAsked = useRef(0);
  const refreshCar = useCallback(async () => {
    const mine = ++carAsked.current;
    if (!car || !paintDir || !libraryRoot || !/^\d+$/.test(customerId)) {
      setInstalled(null);
      setBackups([]);
      return;
    }
    try {
      const [state, list] = await Promise.all([
        api.carState({
          paintDir,
          libraryRoot,
          carFolder: car.folder,
          simFolder: car.simFolder ?? car.installPath,
          customerId,
        }),
        api.listBackups(car.folder),
      ]);
      if (mine !== carAsked.current) return;
      setInstalled(state);
      setBackups(list);
    } catch (e) {
      if (mine !== carAsked.current) return;
      setInstalled(null);
      setBackups([]);
      say("bad", "Could not read the car's folder", [errorText(e)]);
    }
  }, [car, paintDir, libraryRoot, customerId, say]);

  // An apply or a revert reads the car again when it is done, and by then another car may be the one on
  // the page: what they call is the refreshCar of now, not of the render they began in.
  const latestRefreshCar = useRef(refreshCar);
  useEffect(() => {
    latestRefreshCar.current = refreshCar;
    void refreshCar();
  }, [refreshCar]);

  // What was read, and what was refused, for the last car or group are not this one's. Before the page is
  // painted, so that they are never seen under this one's name.
  useLayoutEffect(() => {
    setInstalled(null);
    setBackups([]);
    setRefused(null);
  }, [selectedFolder, selectedGroup]);

  useLayoutEffect(() => {
    setGroupReport(null);
  }, [selectedGroup]);

  const selectCar = (folder: string) => {
    setEditing(null);
    setSelectedGroup(null);
    setSelectedFolder(folder);
  };
  const selectGroup = (id: string) => {
    setEditing(null);
    setSelectedGroup(id);
  };

  // --- guards ---------------------------------------------------------------------------
  useEffect(() => {
    let live = true;
    // Inside The Racing Desk the page stays mounted while another page is up, or the window is minimised behind
    // a race. Nobody is looking at the chips then, and each check starts a process — so it waits until somebody
    // is. Apply does not depend on this: it asks again, itself.
    const watched = () =>
      !document.hidden && (document.querySelector(".paints-app")?.getClientRects().length ?? 0) > 0;
    const tick = () => {
      if (!watched()) return;
      api.tradingPaintsStatus().then((v) => live && setTp(v)).catch(() => {});
      api.simStatus().then((v) => live && setSim(v)).catch(() => {});
    };
    tick();
    const h = setInterval(tick, GUARD_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    document.addEventListener("racingdesk:page", tick);   // the desk, on showing a page
    return () => {
      live = false;
      clearInterval(h);
      document.removeEventListener("visibilitychange", tick);
      document.removeEventListener("racingdesk:page", tick);
    };
  }, []);

  /// Whether something stands in every apply's way right now — the sim running, the downloader — asked
  /// afresh. Only then is going on regardless worth offering: a file that could not be written is not
  /// made writable by insisting.
  const standsInTheWay = async (): Promise<boolean> => {
    try {
      const [s, t] = await Promise.all([api.simStatus(), api.tradingPaintsStatus()]);
      setSim(s);
      setTp(t);
      return s.simRunning || t.running;
    } catch {
      return false;
    }
  };

  // --- actions --------------------------------------------------------------------------
  // One click applies: how is set once, under "When a livery is applied", and what stands in the way is
  // said where the click was, with going on regardless as a second one.
  const doApply = async (version: Version, force: boolean) => {
    if (!car || !target) return;
    const applyingTo = car.folder;
    const name = carName;
    setRefused(null);
    setBusy(true);
    try {
      const report = await api.applyVersion({
        paintDir,
        libraryRoot,
        carFolder: car.folder,
        simFolder: target,
        versionId: version.id,
        customerId,
        includeSpec: options.includeSpec,
        setReadOnlyAfter: options.setReadOnlyAfter,
        clearOtherCooked: options.clearOtherCooked,
        force,
      });
      say("ok", `Applied ${version.name} to ${name}`, [
        ...report.actions.map((a) => a.detail),
        ...report.warnings,
      ]);
    } catch (e) {
      const reason = errorText(e);
      say("bad", `Did not apply ${version.name} to ${name}`, [reason]);
      const canForce = !force && (await standsInTheWay());
      setRefused({ what: "version", carFolder: applyingTo, version, reason, canForce });
    } finally {
      setBusy(false);
      await latestRefreshCar.current();
    }
  };

  const doRevert = async (backupId: string | null) => {
    if (!car?.simFolder) return;
    setBusy(true);
    try {
      const report = await api.revertCar({
        paintDir,
        carFolder: car.folder,
        simFolder: car.simFolder,
        customerId,
        backupId,
        force: false,
      });
      say("ok", `Reverted ${carName}`, [
        ...report.actions.map((a) => a.detail),
        ...report.warnings,
      ]);
    } catch (e) {
      say("bad", `Did not revert ${carName}`, [errorText(e)]);
    } finally {
      setBusy(false);
      await latestRefreshCar.current();
    }
  };

  const nameOf = (folder: string) => {
    const found = cars?.find((c) => c.folder === folder);
    return found ? carLabel(found) : folder;
  };

  const doSetGroup = async (which: LiveryGroup, force: boolean) => {
    setRefused(null);
    setGroupReport(null);
    setBusy(true);
    try {
      const report = await api.setGroup({
        paintDir,
        libraryRoot,
        customerId,
        groupId: which.id,
        includeSpec: options.includeSpec,
        setReadOnlyAfter: options.setReadOnlyAfter,
        clearOtherCooked: options.clearOtherCooked,
        force,
      });
      setGroupReport(report);
      const counts = [
        report.applied > 0 && `${report.applied} applied`,
        report.already > 0 && `${report.already} already on`,
        report.skipped > 0 && `${report.skipped} skipped`,
        report.failed > 0 && `${report.failed} failed`,
      ].filter(Boolean);
      say(
        report.failed > 0 ? "bad" : "ok",
        `Set ${report.name}: ${counts.join(", ") || "no cars"}`,
        [
          ...report.results
            .filter((r) => r.outcome === "skipped" || r.outcome === "failed")
            .map((r) => `${nameOf(r.folder)}: ${r.detail}`),
          ...report.results.flatMap((r) => r.warnings.map((w) => `${nameOf(r.folder)}: ${w}`)),
          ...report.warnings,
        ],
      );
    } catch (e) {
      const reason = errorText(e);
      say("bad", `Did not set ${which.name}`, [reason]);
      const canForce = !force && (await standsInTheWay());
      setRefused({ what: "group", groupId: which.id, reason, canForce });
    } finally {
      setBusy(false);
      await latestRefreshCar.current();
    }
  };

  const doSaveGroup = async (name: string, chosen: Record<string, string | null>) => {
    setEditError(null);
    setBusy(true);
    try {
      const saved = await api.saveGroup({
        libraryRoot,
        paintDir: paintDir || null,
        id: editing?.group?.id ?? null,
        name,
        cars: chosen,
      });
      setGroups(await api.liveryGroups(libraryRoot, paintDir || null));
      setEditing(null);
      setSelectedGroup(saved.id);
      say("ok", `${editing?.group ? "Changed" : "Made"} the group ${saved.name}`, [
        `${saved.cars.length} car${saved.cars.length === 1 ? "" : "s"} in it`,
      ]);
    } catch (e) {
      setEditError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const doDeleteGroup = async (which: LiveryGroup) => {
    setBusy(true);
    try {
      await api.deleteGroup(which.id);
      setGroups(await api.liveryGroups(libraryRoot, paintDir || null));
      setSelectedGroup(null);
      say("info", `Forgot the group ${which.name}`, ["The liveries are in the library as they were."]);
    } catch (e) {
      say("bad", `Could not forget ${which.name}`, [errorText(e)]);
    } finally {
      setBusy(false);
    }
  };

  const idValid = /^\d+$/.test(customerId);
  const status = useMemo(
    () => collectStatus({ sim, tp, repo, car, idValid }),
    [sim, tp, repo, car, idValid],
  );
  const painted = (cars ?? []).some((c) => c.versions.length > 0);

  /// The cars the host keeps a view or pedals for, to be marked in the list.
  const kept: Kept = useMemo(
    () => ({
      view: new Set(rig.rig?.views?.keys() ?? []),
      pedals: new Set(
        [...(rig.rig?.pedals?.cars ?? [])].filter(([, row]) => hasPedals(row)).map(([key]) => key),
      ),
    }),
    [rig.rig],
  );
  const carKey = car ? rigKey(car) : "";

  /// What stands where the cars would be while there are none to show.
  const noCars = !listable
    ? { list: "Pick a library folder above.", page: "Pick a library folder to get started." }
    : listing === "reading"
      ? { list: "Reading the cars…", page: "Reading the cars…" }
      : listing === "failed"
        ? {
            list: "The cars could not be read.",
            page: "The cars could not be read. What went wrong is below.",
          }
        : {
            list: "No cars in this folder.",
            page: "Nothing to show. Point the library at a folder of car folders.",
          };

  return (
    <div className="paints-app">
      <SetupBar
        paintDir={paintDir}
        paintReport={pathReport}
        libraryRoot={libraryRoot}
        customerId={customerId}
        customerReport={customerReport}
        suggestions={suggestions}
        onPaintDir={setPaintDir}
        onLibraryRoot={setLibraryRoot}
        onCustomerId={setCustomerId}
      >
        <StatusChips items={status} />
        {/* The cars, and what the host keeps for them. A new list is a new car to read, which the effect
            on it does. */}
        <button
          onClick={() => {
            void refreshLibrary();
            void rig.refresh();
          }}
          disabled={busy}
        >
          Refresh
        </button>
      </SetupBar>

      <div className="body">
        <CarList
          cars={cars ?? []}
          selected={selectedGroup || editing ? null : selectedFolder}
          onSelect={selectCar}
          empty={noCars.list}
          kept={kept}
          groups={groups}
          selectedGroup={editing ? null : selectedGroup}
          onSelectGroup={selectGroup}
          onNewGroup={
            inDesk() && painted
              ? () => {
                  setEditError(null);
                  setEditing({ group: null });
                }
              : null
          }
        />

        <div className="main">
          <RepoPanel
            repo={repo}
            busy={busy}
            checking={checking}
            autoUpdate={autoUpdate}
            onAutoUpdate={setAutoUpdate}
            onCheck={() => void checkForUpdates()}
            onUpdate={() => void updateLibrary()}
          />

          {editing ? (
            <GroupEditor
              key={editing.group?.id ?? "new"}
              group={editing.group}
              cars={cars ?? []}
              busy={busy}
              error={editError}
              onSave={(name, chosen) => void doSaveGroup(name, chosen)}
              onCancel={() => setEditing(null)}
            />
          ) : group ? (
            <>
              {refused?.what === "group" && refused.groupId === group.id && (
                <Refusal
                  reason={refused.reason}
                  canForce={refused.canForce}
                  busy={busy}
                  forceLabel="Set anyway"
                  onForce={() => void doSetGroup(group, true)}
                  onDismiss={() => setRefused(null)}
                />
              )}
              <GroupPage
                group={group}
                cars={cars ?? []}
                busy={busy}
                ready={idValid && !!paintDir && !!libraryRoot}
                report={groupReport?.groupId === group.id ? groupReport : null}
                onSet={() => void doSetGroup(group, false)}
                onEdit={() => {
                  setEditError(null);
                  setEditing({ group });
                }}
                onDelete={() => void doDeleteGroup(group)}
                onSelectCar={selectCar}
              />
              <ApplyOptionsPanel options={options} onOptions={setOptions} />
            </>
          ) : car ? (
            <>
              <div className="car-head">
                <h2>{carName}</h2>
                <div className="note">
                  <span className="mono">{car.folder}</span>
                  {car.simFolder !== null && car.simFolder !== car.folder && (
                    <>
                      {" "}
                      · installs to <span className="mono">{car.simFolder}</span>
                    </>
                  )}
                  {car.driven > 0 &&
                    ` · driven in ${car.driven} session${car.driven === 1 ? "" : "s"}`}
                </div>
              </div>

              {refused?.what === "version" && refused.carFolder === car.folder && (
                <Refusal
                  reason={refused.reason}
                  canForce={refused.canForce}
                  busy={busy}
                  forceLabel={`Apply ${refused.version.name} anyway`}
                  onForce={() => void doApply(refused.version, true)}
                  onDismiss={() => setRefused(null)}
                />
              )}

              {car.versions.length > 0 ? (
                <>
                  <div className="versions">
                    {car.versions.map((v) => (
                      <VersionCard
                        key={v.id}
                        version={v}
                        installed={installed}
                        busy={busy || !idValid || !target}
                        onApply={() => void doApply(v, false)}
                      />
                    ))}
                  </div>
                  {!target && (
                    <div className="note">
                      This car is not in the sim: it has no folder in the paint directory and is not
                      in the iRacing install, so there is nowhere to apply a livery to.
                    </div>
                  )}
                  <ApplyOptionsPanel options={options} onOptions={setOptions} />
                </>
              ) : libraryRoot ? (
                <div className="panel no-livery">
                  <h3>No livery yet</h3>
                  <div>
                    There is no livery for this car in the library. A version goes in{" "}
                    <code>{versionHome(libraryRoot, car.folder)}</code>
                  </div>
                  <div className="note">
                    It holds the paint as <code>car.tga</code> and, if there is one, the spec map as{" "}
                    <code>car_spec.tga</code>.
                  </div>
                </div>
              ) : (
                <div className="panel no-livery">
                  <h3>No livery yet</h3>
                  <div>There is no library to keep liveries in. Pick its folder above.</div>
                </div>
              )}

              {/* The car as it is driven, after the car as it is painted. */}
              <CarViewPanel
                here={rig.here}
                rig={rig.rig}
                view={rig.rig?.views?.get(carKey) ?? null}
                lastDriven={lastDriven.get(carKey) ?? null}
              />
              {/* Keyed by the car: where the keyboard was while one car's pedals were saved is not
                  another's. */}
              <CarPedalsPanel
                key={car.folder}
                here={rig.here}
                rig={rig.rig}
                carName={carName}
                carPath={rig.rig?.paths.get(carKey) ?? null}
                bound={rig.rig?.pedals?.cars.get(carKey) ?? null}
                saving={rig.saving.get(carKey)}
                note={rig.notes.get(carKey) ?? null}
                onBind={(path, profileId) => void rig.bind(path, profileId)}
              />

              <div className="panel">
                <h3>Installed in the sim</h3>
                {!installed?.folderExists ? (
                  <div className="note">
                    {car.simFolder || !idValid
                      ? "Nothing to read yet."
                      : car.installPath
                        ? "This car has no folder in the paint directory yet. Applying a livery makes it; so does the sim, the first time you drive the car."
                        : "This car has no folder in the paint directory yet. The sim creates it the first time you drive the car."}
                  </div>
                ) : installed.files.length === 0 ? (
                  <div className="note">
                    No files for customer {customerId} in {installed.simFolder}.
                  </div>
                ) : (
                  <div className="rows">
                    {installed.files.map((f) => (
                      <div className="row-line" key={f.path}>
                        <span className="grow mono">{f.fileName}</span>
                        <span className="note">{f.roleLabel}</span>
                        {f.readOnly && <span className="badge likely">read-only</span>}
                      </div>
                    ))}
                    <div className="row-line">
                      <span className="grow note">
                        {installed.cooked.length} cooked .mip file(s) for this customer
                        {installed.cookedOtherDrivers > 0 &&
                          `, ${installed.cookedOtherDrivers} belonging to other drivers`}
                      </span>
                      <button
                        onClick={() =>
                          installed.files[0] &&
                          reveal(installed.files[0].path).catch(() => {})
                        }
                      >
                        Show in Explorer
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="panel">
                <h3>Backups</h3>
                {backups.length === 0 ? (
                  <div className="note">
                    Nothing backed up for this car yet. One is taken before every apply.
                  </div>
                ) : (
                  <div className="rows">
                    {backups.slice(0, 8).map((b, i) => (
                      <div className="row-line" key={b.id}>
                        <span className="grow">
                          <span className="mono">{b.id}</span>{" "}
                          <span className="note">
                            — {b.reason}, {b.fileCount} file(s)
                          </span>
                        </span>
                        <button
                          className={i === 0 ? "danger" : ""}
                          disabled={busy || !car.simFolder}
                          onClick={() => void doRevert(b.id)}
                        >
                          {i === 0 ? "Revert to this" : "Restore"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <TradingPaintsPanel tp={tp} />
            </>
          ) : (
            <div className="empty">{noCars.page}</div>
          )}

          {/* Whether or not there is a car to show: what went wrong reading the cars is said here. */}
          {log.length > 0 && (
            <div className="panel">
              <h3>Activity</h3>
              <div className="log">
                {log.map((e) => (
                  <div className={`entry ${e.kind}`} key={e.id}>
                    <div>
                      <span className="when">{e.when}</span> {e.title}
                    </div>
                    {e.lines.map((l, i) => (
                      <div className="note" key={i}>
                        {l}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
