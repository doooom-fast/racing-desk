import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import * as api from "./api";
import { errorText } from "./api";
import { ApplyDialog, type ApplyOptions } from "./components/ApplyDialog";
import { TradingPaintsPanel } from "./components/Guards";
import { RepoPanel } from "./components/RepoPanel";
import { SetupBar } from "./components/SetupBar";
import { collectStatus, StatusChips } from "./components/StatusChips";
import { VersionCard } from "./components/VersionCard";
import type {
  BackupEntry,
  Car,
  CustomerReport,
  InstalledState,
  Library,
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
  const [library, setLibrary] = useState<Library | null>(null);
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

  // --- library --------------------------------------------------------------------------
  const refreshLibrary = useCallback(async () => {
    if (!libraryRoot) {
      setLibrary(null);
      return;
    }
    try {
      const lib = await api.scanLibrary(libraryRoot, paintDir || null);
      setLibrary(lib);
      setSelectedFolder((current) =>
        current && lib.cars.some((c) => c.folder === current)
          ? current
          : (lib.cars[0]?.folder ?? null),
      );
    } catch (e) {
      setLibrary(null);
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

  const car: Car | null = useMemo(
    () => library?.cars.find((c) => c.folder === selectedFolder) ?? null,
    [library, selectedFolder],
  );

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
        api.listBackups(libraryRoot, car.folder),
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
    const tick = () => {
      api.tradingPaintsStatus().then((v) => live && setTp(v)).catch(() => {});
      api.simStatus().then((v) => live && setSim(v)).catch(() => {});
    };
    tick();
    const h = setInterval(tick, GUARD_POLL_MS);
    return () => {
      live = false;
      clearInterval(h);
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
      say("ok", `Applied ${version.name} to ${car.simFolder}`, [
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
        libraryRoot,
        carFolder: car.folder,
        simFolder: car.simFolder,
        customerId,
        backupId,
        force: false,
      });
      say("ok", `Reverted ${car.folder}`, [
        ...report.actions.map((a) => a.detail),
        ...report.warnings,
      ]);
    } catch (e) {
      say("bad", `Did not revert ${car.folder}`, [errorText(e)]);
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
    <div className="app">
      <div className="titlebar">
        <span className="wordmark">DOOOOM</span>
        <span className="sub">paints</span>
        <span className="spacer" />
        <StatusChips items={status} />
        <button onClick={() => void refreshLibrary().then(refreshCar)} disabled={busy}>
          Refresh
        </button>
      </div>

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
      />

      <div className="body">
        <div className="sidebar">
          <div className="heading">Cars</div>
          {!library || library.cars.length === 0 ? (
            <div className="empty" style={{ padding: "12px 14px", textAlign: "left" }}>
              {libraryRoot ? "No cars in this folder." : "Pick a library folder above."}
            </div>
          ) : (
            library.cars.map((c) => (
              <button
                key={c.folder}
                className={`car ${c.folder === selectedFolder ? "active" : ""}`}
                onClick={() => setSelectedFolder(c.folder)}
              >
                <span className="name">{c.folder}</span>
                <span className="meta">
                  {c.versions.length} version{c.versions.length === 1 ? "" : "s"}
                  {!c.simFolder && " · not in the sim"}
                  {c.simFolderInferred && ` · installs to ${c.simFolder}`}
                </span>
              </button>
            ))
          )}
        </div>

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

              <div className="panel">
                <h3>Installed in the sim</h3>
                {!installed?.folderExists ? (
                  <div className="note">Nothing to read yet.</div>
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
                          revealItemInDir(installed.files[0].path).catch(() => {})
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
