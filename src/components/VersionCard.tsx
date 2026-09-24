import { useEffect, useMemo, useState } from "react";
import { previewImage } from "../api";
import type { InstalledState, Version, VersionFile } from "../types";

interface Source {
  key: string;
  label: string;
  path: string;
}

/// Tidy a preview filename into something that fits under a card.
/// `preview_topview_nose_up.png` -> `topview nose up`
function previewLabel(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const stem = name.replace(/\.[^.]+$/, "").replace(/^preview[-_]?/i, "");
  return stem.replace(/[-_]+/g, " ").trim() || "preview";
}

/// Everything worth looking at for one version: the pipeline's renders first, then the
/// textures themselves. The renders show the car; the textures are what actually gets
/// installed, which is the thing worth checking before an apply.
function sourcesFor(version: Version): Source[] {
  const out: Source[] = version.previews.map((p) => ({
    key: p,
    label: previewLabel(p),
    path: p,
  }));
  const byRole = (role: string): VersionFile | undefined =>
    version.files.find((f) => f.role === role);
  for (const role of ["car", "car_spec", "car_decal", "car_num"]) {
    const file = byRole(role);
    if (file) {
      out.push({
        key: role,
        label: role === "car" ? "paint" : role.replace("car_", ""),
        path: file.path,
      });
    }
  }
  return out;
}

function Preview({ source }: { source: Source | undefined }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSrc(null);
    setError(null);
    if (!source) return;
    previewImage(source.path, 640)
      .then((d) => live && setSrc(d))
      .catch((e) => live && setError(typeof e === "string" ? e : "unreadable"));
    return () => {
      live = false;
    };
  }, [source?.path]);

  return (
    <div className="preview">
      {src ? (
        <img src={src} alt={source?.label ?? ""} />
      ) : (
        <span className="none" title={error ?? undefined}>
          {!source ? "nothing to show" : error ? "unreadable" : "…"}
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
  const sources = useMemo(() => sourcesFor(version), [version]);
  const [index, setIndex] = useState(0);
  const current = sources[Math.min(index, sources.length - 1)];

  const isApplied = installed?.appliedVersionId === version.id;
  const exact = isApplied && installed?.matchKind === "exact";
  const partial = isApplied && installed?.matchKind === "paint-only";

  const roles = version.files.map((f) => f.roleLabel).join(" + ") || "nothing installable";

  return (
    <div className={`card ${exact ? "applied" : ""}`}>
      <Preview source={current} />
      {sources.length > 1 && (
        <div className="views">
          {sources.map((s, i) => (
            <button
              key={s.key}
              className={`view ${i === index ? "on" : ""}`}
              onClick={() => setIndex(i)}
              title={s.path}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
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
