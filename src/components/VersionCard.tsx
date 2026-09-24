import { useEffect, useState } from "react";
import { loadPreview } from "../api";
import type { InstalledState, Version } from "../types";

/// Preview images live wherever the library does, so they are fetched through Rust as data
/// URLs rather than handed to the webview as file paths.
function Preview({ paths }: { paths: string[] }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Prefer a plain `preview.png`, else whichever sorts first.
  const chosen =
    paths.find((p) => /[\\/]preview\.(png|jpe?g|webp)$/i.test(p)) ?? paths[0];

  useEffect(() => {
    let live = true;
    setSrc(null);
    setFailed(false);
    if (!chosen) return;
    loadPreview(chosen)
      .then((d) => live && setSrc(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [chosen]);

  return (
    <div className="preview">
      {src ? (
        <img src={src} alt="" />
      ) : (
        <span className="none">
          {!chosen ? "no preview" : failed ? "preview unreadable" : "…"}
        </span>
      )}
    </div>
  );
}

export function VersionCard({
  version,
  installed,
  busy,
  onApply,
}: {
  version: Version;
  installed: InstalledState | null;
  busy: boolean;
  onApply: () => void;
}) {
  const isApplied = installed?.appliedVersionId === version.id;
  const exact = isApplied && installed?.matchKind === "exact";
  const partial = isApplied && installed?.matchKind === "paint-only";

  const roles = version.files.map((f) => f.roleLabel).join(" + ") || "nothing installable";

  return (
    <div className={`card ${exact ? "applied" : ""}`}>
      <Preview paths={version.previews} />
      <div className="head">
        <span className="name">{version.name}</span>
        {exact && <span className="badge applied">applied</span>}
        {partial && <span className="badge partial">paint only</span>}
      </div>
      <div className="roles">{roles}</div>
      {version.meta.notes && <div className="notes">{version.meta.notes}</div>}
      {version.problems.length > 0 && (
        <div className="problems">
          {version.problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </div>
      )}
      <div className="actions">
        <button
          className="primary"
          disabled={busy || !version.hasPaint}
          onClick={onApply}
          title={version.hasPaint ? "" : "This version has no car paint to install"}
        >
          {exact ? "Re-apply" : "Apply"}
        </button>
        {partial && (
          <span className="note" style={{ color: "var(--warn)" }}>
            the paint matches but the spec map does not
          </span>
        )}
      </div>
    </div>
  );
}
