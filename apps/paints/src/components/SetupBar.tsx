import type { ReactNode } from "react";
import { pickFolder } from "../bridge";
import type { CustomerReport, LibrarySuggestion, PathReport } from "../types";

/// The three things every swap depends on, always on screen, and what stands in a swap's way.
///
/// The plan is explicit that the resolved paint path must always be visible, because the
/// failure it prevents — editing one Documents folder while the sim reads another — looks
/// exactly like the app doing nothing at all.
///
/// `children` are the status chips and Refresh, at the right-hand end. They had a bar of their own
/// with the app's name in it; the host's window says where you are, and the bar went.
export function SetupBar({
  paintDir,
  paintReport,
  libraryRoot,
  customerId,
  customerReport,
  suggestions,
  onPaintDir,
  onLibraryRoot,
  onCustomerId,
  children,
}: {
  children?: ReactNode;
  paintDir: string;
  paintReport: PathReport | null;
  libraryRoot: string;
  customerId: string;
  customerReport: CustomerReport | null;
  suggestions: LibrarySuggestion[];
  onPaintDir: (v: string) => void;
  onLibraryRoot: (v: string) => void;
  onCustomerId: (v: string) => void;
}) {
  const alternatives = (paintReport?.candidates ?? []).filter(
    (c) => c.exists && c.path !== paintDir,
  );
  const idValid = /^\d+$/.test(customerId);
  const others = suggestions.filter((s) => s.path !== libraryRoot);
  const confidence = customerReport?.confidence;

  return (
    <div className="setup">
      <div className="field">
        <span className="label">iRacing paint folder</span>
        <div className="row">
          <input
            type="text"
            className="mono"
            value={paintDir}
            spellCheck={false}
            onChange={(e) => onPaintDir(e.target.value)}
          />
          <button
            onClick={async () => {
              const p = await pickFolder("Pick the iRacing paint folder", paintDir);
              if (p) onPaintDir(p);
            }}
          >
            Browse
          </button>
        </div>
        {alternatives.length > 0 && (
          <span className="note" style={{ color: "var(--warn)" }}>
            Another paint folder also exists:{" "}
            {alternatives.map((a) => (
              <button
                key={a.path}
                className="link"
                onClick={() => onPaintDir(a.path)}
                title={`${a.carFolders} car folders`}
              >
                {a.isOneDrive ? "OneDrive copy" : a.path}
              </button>
            ))}
            . Make sure this is the one the sim reads.
          </span>
        )}
      </div>

      <div className="field">
        <span className="label">Library</span>
        <div className="row">
          <input
            type="text"
            className="mono"
            value={libraryRoot}
            spellCheck={false}
            onChange={(e) => onLibraryRoot(e.target.value)}
          />
          <button
            onClick={async () => {
              const p = await pickFolder("Pick the library folder", libraryRoot);
              if (p) onLibraryRoot(p);
            }}
          >
            Browse
          </button>
        </div>
        {others.length > 0 ? (
          <span className="note">
            Also found:{" "}
            {others.map((s) => (
              <button
                key={s.path}
                className="link"
                onClick={() => onLibraryRoot(s.path)}
                title={`${s.path} — ${s.cars} car folder(s)${
                  s.repo.isRepo ? ", a git checkout" : ""
                }`}
                style={{ marginRight: 8 }}
              >
                {s.path.split(/[\\/]/).slice(-2).join("/")}
              </button>
            ))}
          </span>
        ) : (
          <span className="note">A folder of car folders, each holding version folders.</span>
        )}
      </div>

      <div className="field narrow">
        <span className="label">Customer ID</span>
        <div className="row">
          <input
            type="text"
            className="mono"
            value={customerId}
            spellCheck={false}
            style={{ maxWidth: 140 }}
            onChange={(e) => onCustomerId(e.target.value.trim())}
          />
          {confidence && <span className={`badge ${confidence}`}>{confidence}</span>}
        </div>
        <span className="note" style={{ color: idValid ? undefined : "var(--bad)" }}>
          {!idValid
            ? "A customer ID is digits only."
            : (customerReport?.source ?? "set by hand")}
        </span>
      </div>

      {children && (
        <div className="field narrow status">
          <span className="label">Status</span>
          <div className="row">{children}</div>
        </div>
      )}
    </div>
  );
}
