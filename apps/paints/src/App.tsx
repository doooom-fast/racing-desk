import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api";
import { reveal } from "./bridge";
import { errorText } from "./api";
import { ApplyDialog, type ApplyOptions } from "./components/ApplyDialog";
import { CarList, carLabel, groupCars } from "./components/CarList";
import { TradingPaintsPanel } from "./components/Guards";
import { RepoPanel } from "./components/RepoPanel";
import { SetupBar } from "./components/SetupBar";
import { collectStatus, StatusChips } from "./components/StatusChips";
import { VersionCard } from "./components/VersionCard";
import type {
  BackupEntry,
  CatalogueCar,
  CustomerReport,
  InstalledState,
  LibrarySuggestion,
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
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [installed, setInstalled] = useState<InstalledState | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [tp, setTp] = useState<TradingPaints | null>(null);
  const [sim, setSim] = useState<SimState | null>(null);
  const [suggestions, setSuggestions] = useState<LibrarySuggestion[]>([]);
  const [repo, setRepo] = useState<RepoStatus | null>(null);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [checking, setChecking] = useState(false);

  const [applying, setApplying] = useState<Version | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logId = useRef(0);
  const ready = useRef(false);

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
      })
      .catch(() => {});
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
  // a path asks again — and the list has to be the last one asked for, not the last one to arrive.
  const asked = useRef(0);
  const refreshLibrary = useCallback(async () => {
    const mine = ++asked.current;
    if (!libraryRoot) {
      setCars(null);
      return;
    }
    try {
      const found = await api.carCatalogue(libraryRoot, paintDir || null);
      if (mine !== asked.current) return;
      setCars(found);
      // A car that is still there stays selected; otherwise the first with a livery, as the list shows it.
      setSelectedFolder((current) => {
        if (current && found.some((c) => c.folder === current)) return current;
        const { liveries, rest } = groupCars(found);
        return (liveries[0] ?? rest[0])?.folder ?? null;
      });
    } catch (e) {
      if (mine !== asked.current) return;
      setCars(null);
      say("bad", "Could not read the library", [errorText(e)]);
    }
  }, [libraryRoot, paintDir, say]);

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

  // --- installed state for the selected car ---------------------------------------------
  const refreshCar = useCallback(async () => {
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
          simFolder: car.simFolder,
          customerId,
        }),
        api.listBackups(car.folder),
      ]);
      setInstalled(state);
      setBackups(list);
    } catch (e) {
      setInstalled(null);
      say("bad", "Could not read the car's folder", [errorText(e)]);
    }
  }, [car, paintDir, libraryRoot, customerId, say]);

  useEffect(() => {
    void refreshCar();
  }, [refreshCar]);

  // --- guards ---------------------------------------------------------------------------
  useEffect(() => {
    let live = true;
    // Inside The Racing Desk the page stays mounted while another page is up, or the window is minimised behind
    // a race. Nobody is looking at the chips then, and each check starts a process — so it waits until somebody
    // is. Apply does not depend on this: its preflight asks again, itself.
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

  // --- actions --------------------------------------------------------------------------
  const doApply = async (version: Version, force: boolean) => {
    if (!car?.simFolder) return;
    setApplying(null);
    setBusy(true);
    try {
      const report = await api.applyVersion({
        paintDir,
        libraryRoot,
        carFolder: car.folder,
        simFolder: car.simFolder,
        versionId: version.id,
        customerId,
        includeSpec: options.includeSpec,
        setReadOnlyAfter: options.setReadOnlyAfter,
        clearOtherCooked: options.clearOtherCooked,
        force,
      });
      say("ok", `Applied ${version.name} to ${carName}`, [
        ...report.actions.map((a) => a.detail),
        ...report.warnings,
      ]);
    } catch (e) {
      say("bad", `Did not apply ${version.name}`, [errorText(e)]);
    } finally {
      setBusy(false);
      await refreshCar();
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
      await refreshCar();
    }
  };

  const idValid = /^\d+$/.test(customerId);
  const status = useMemo(
    () => collectStatus({ sim, tp, repo, car, idValid }),
    [sim, tp, repo, car, idValid],
  );

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
        <button onClick={() => void refreshLibrary().then(refreshCar)} disabled={busy}>
          Refresh
        </button>
      </SetupBar>

      <div className="body">
        <CarList
          cars={cars ?? []}
          selected={selectedFolder}
          onSelect={setSelectedFolder}
          empty={libraryRoot ? "No cars in this folder." : "Pick a library folder above."}
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

          {car ? (
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

              {car.versions.length > 0 ? (
                <div className="versions">
                  {car.versions.map((v) => (
                    <VersionCard
                      key={v.id}
                      version={v}
                      installed={installed}
                      busy={busy || !idValid || !car.simFolder}
                      onApply={() => setApplying(v)}
                    />
                  ))}
                </div>
              ) : (
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
              )}

              <div className="panel">
                <h3>Installed in the sim</h3>
                {!installed?.folderExists ? (
                  <div className="note">
                    {car.simFolder || !idValid
                      ? "Nothing to read yet."
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
            </>
          ) : (
            <div className="empty">
              {libraryRoot
                ? "Nothing to show. Point the library at a folder of car folders."
                : "Pick a library folder to get started."}
            </div>
          )}
        </div>
      </div>

      {applying && car?.simFolder && (
        <ApplyDialog
          version={applying}
          carName={carName}
          simFolder={car.simFolder}
          paintDir={paintDir}
          customerId={customerId}
          options={options}
          onOptions={setOptions}
          onCancel={() => setApplying(null)}
          onConfirm={(force) => void doApply(applying, force)}
        />
      )}
    </div>
  );
}
