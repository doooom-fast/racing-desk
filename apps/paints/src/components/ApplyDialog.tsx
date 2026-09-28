import { useEffect, useState } from "react";
import { errorText, preflight } from "../api";
import type { Preflight, Version } from "../types";

export interface ApplyOptions {
  includeSpec: boolean;
  setReadOnlyAfter: boolean;
  clearOtherCooked: boolean;
}

/// Confirms an apply, after saying out loud what it is about to do and what stands in the way.
///
/// Blockers do not hide the button — the plan asks for "say so before applying and offer to
/// keep going" — but going ahead over one is a separate, explicit click.
export function ApplyDialog({
  version,
  carName,
  simFolder,
  paintDir,
  customerId,
  options,
  onOptions,
  onCancel,
  onConfirm,
}: {
  version: Version;
  /// The car as the list names it.
  carName: string;
  simFolder: string;
  paintDir: string;
  customerId: string;
  options: ApplyOptions;
  onOptions: (o: ApplyOptions) => void;
  onCancel: () => void;
  onConfirm: (force: boolean) => void;
}) {
  const [pre, setPre] = useState<Preflight | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    let live = true;
    preflight(paintDir, simFolder)
      .then((p) => live && setPre(p))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [paintDir, simFolder]);

  const blocked = (pre?.blockers.length ?? 0) > 0;
  const installing = version.files.filter(
    (f) => options.includeSpec || f.role !== "car_spec",
  );

  return (
    <div className="scrim" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Apply {version.name}</h2>
        <div className="sub">
          to <span className="car">{carName}</span>, into <code>{simFolder}</code> as customer{" "}
          <code>{customerId}</code>
        </div>

        <div className="panel" style={{ marginBottom: 12 }}>
          <h3>What will happen</h3>
          <div className="rows">
            {installing.map((f) => (
              <div className="row-line" key={f.role}>
                <span className="grow mono">{f.fileName}</span>
                <span className="mono">
                  → {f.role}_{customerId}.tga
                </span>
              </div>
            ))}
            <div className="row-line">
              <span className="grow">
                Current files are backed up first, and this customer&apos;s cooked{" "}
                <code>.mip</code> files are deleted so the sim re-cooks.
              </span>
            </div>
          </div>
        </div>

        <div className="options">
          <label className="check">
            <input
              type="checkbox"
              checked={options.includeSpec}
              disabled={!version.hasSpec}
              onChange={(e) => onOptions({ ...options, includeSpec: e.target.checked })}
            />
            Install the spec map
            {!version.hasSpec && <span className="note"> (none in this version)</span>}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={options.setReadOnlyAfter}
              onChange={(e) =>
                onOptions({ ...options, setReadOnlyAfter: e.target.checked })
              }
            />
            Set read-only afterwards
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={options.clearOtherCooked}
              onChange={(e) =>
                onOptions({ ...options, clearOtherCooked: e.target.checked })
              }
            />
            Also clear other drivers&apos; cooked files
          </label>
        </div>

        {error && (
          <div className="banner bad" style={{ marginTop: 12 }}>
            <span className="mark">!</span>
            <div>{error}</div>
          </div>
        )}

        {pre && (pre.blockers.length > 0 || pre.warnings.length > 0) && (
          <div
            className={`banner ${pre.blockers.length ? "bad" : "warn"}`}
            style={{ marginTop: 12 }}
          >
            <span className="mark">!</span>
            <div>
              <ul>
                {pre.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
                {pre.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              {blocked && (
                <label className="check" style={{ marginTop: 6 }}>
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                  />
                  Apply anyway
                </label>
              )}
            </div>
          </div>
        )}

        <div className="foot">
          <button onClick={onCancel}>Cancel</button>
          <button
            className="primary"
            disabled={!pre || (blocked && !acknowledged)}
            onClick={() => onConfirm(blocked)}
          >
            {blocked ? "Apply anyway" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
