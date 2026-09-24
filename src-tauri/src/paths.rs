//! Finding `Documents\iRacing\paint`.
//!
//! The trap the plan calls out is real: when OneDrive backs up Documents there are two
//! plausible `Documents` folders, and the sim reads one while you edit the other. The app
//! never picks silently — it collects every candidate, scores them by what is actually in
//! them, and hands the whole list to the UI so the chosen path is always on screen.

use crate::roles;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaintCandidate {
    pub path: String,
    /// Where the path came from, shown in the UI so an odd choice is explainable.
    pub source: String,
    pub exists: bool,
    pub is_one_drive: bool,
    /// Directories directly inside `paint` — an approximation of "cars you have".
    pub car_folders: usize,
    /// Installed car textures seen while sampling — a ranking signal, not a census.
    pub texture_files: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathReport {
    pub candidates: Vec<PaintCandidate>,
    /// The best candidate, or `None` if nothing plausible was found.
    pub chosen: Option<String>,
    /// True when more than one candidate exists on disk — the OneDrive trap.
    pub ambiguous: bool,
    pub notes: Vec<String>,
}

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
}

/// Read the Documents location out of the registry. `Shell Folders` holds the already
/// expanded value; `User Shell Folders` is the authoritative one and may still contain
/// `%USERPROFILE%`. Both are consulted, and both are expanded before use.
#[cfg(windows)]
fn documents_from_registry() -> Vec<(PathBuf, String)> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mut out = Vec::new();
    let keys = [
        (
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders",
            "registry Shell Folders",
        ),
        (
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
            "registry User Shell Folders",
        ),
    ];
    for (subkey, label) in keys {
        let Ok(key) = hkcu.open_subkey(subkey) else {
            continue;
        };
        let Ok(value) = key.get_value::<String, _>("Personal") else {
            continue;
        };
        out.push((PathBuf::from(expand_env(&value)), label.to_string()));
    }
    out
}

#[cfg(not(windows))]
fn documents_from_registry() -> Vec<(PathBuf, String)> {
    Vec::new()
}

/// Expand `%NAME%` references the way the registry stores them. Unknown names are left
/// in place rather than blanked, so a bad expansion shows up as a visibly wrong path
/// instead of silently becoming a plausible-looking one.
fn expand_env(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(v) => out.push_str(&v),
                    Err(_) => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push('%');
                rest = after;
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Count what is in a paint folder, cheaply. This only ranks candidates, so it reads one
/// level of entries and samples a handful of car folders rather than walking thousands.
fn survey(paint: &Path) -> (usize, usize) {
    let Ok(entries) = std::fs::read_dir(paint) else {
        return (0, 0);
    };
    let mut car_folders = 0usize;
    let mut textures = 0usize;
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        if !kind.is_dir() {
            continue;
        }
        car_folders += 1;
        if car_folders <= 12 {
            if let Ok(inner) = std::fs::read_dir(entry.path()) {
                for f in inner.flatten() {
                    if let Some(name) = f.file_name().to_str() {
                        if roles::parse_installed(name).is_some() {
                            textures += 1;
                        }
                    }
                }
            }
        }
    }
    (car_folders, textures)
}

fn looks_like_one_drive(p: &Path) -> bool {
    p.to_string_lossy().to_ascii_lowercase().contains("onedrive")
}

/// Every place `Documents\iRacing\paint` could plausibly be, deduplicated and surveyed.
pub fn detect() -> PathReport {
    let mut roots: Vec<(PathBuf, String, bool)> = Vec::new();

    for (doc, label) in documents_from_registry() {
        let is_od = looks_like_one_drive(&doc);
        roots.push((doc, label, is_od));
    }
    if let Some(profile) = env_path("USERPROFILE") {
        roots.push((profile.join("Documents"), "%USERPROFILE%".into(), false));
    }
    for key in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
        if let Some(od) = env_path(key) {
            roots.push((od.join("Documents"), format!("%{key}%"), true));
        }
    }

    // Deduplicate on the final paint path, keeping the first (most authoritative) source.
    let mut seen: BTreeMap<String, PaintCandidate> = BTreeMap::new();
    let mut order: Vec<String> = Vec::new();
    for (doc, source, is_od) in roots {
        let paint = doc.join("iRacing").join("paint");
        let key = paint.to_string_lossy().to_ascii_lowercase();
        if seen.contains_key(&key) {
            continue;
        }
        let exists = paint.is_dir();
        let (car_folders, texture_files) = if exists { survey(&paint) } else { (0, 0) };
        let candidate = PaintCandidate {
            path: paint.to_string_lossy().to_string(),
            source,
            exists,
            is_one_drive: is_od || looks_like_one_drive(&paint),
            car_folders,
            texture_files,
        };
        order.push(key.clone());
        seen.insert(key, candidate);
    }

    let candidates: Vec<PaintCandidate> =
        order.iter().filter_map(|k| seen.get(k).cloned()).collect();

    let live: Vec<&PaintCandidate> = candidates.iter().filter(|c| c.exists).collect();
    // Rank by what is actually in the folder, not by where the path came from.
    let chosen = live
        .iter()
        .max_by_key(|c| (c.texture_files, c.car_folders))
        .map(|c| c.path.clone());

    let ambiguous = live.len() > 1;
    let mut notes = Vec::new();
    if ambiguous {
        notes.push(
            "More than one iRacing paint folder exists on this machine. OneDrive redirects \
             Documents, and the sim can read one folder while you edit the other. Check the \
             path below is the one the sim uses."
                .to_string(),
        );
    }
    if live.is_empty() {
        notes.push(
            "No iRacing paint folder found. Set it by hand if the sim keeps its files \
             somewhere unusual."
                .to_string(),
        );
    }

    PathReport {
        candidates,
        chosen,
        ambiguous,
        notes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_known_vars() {
        std::env::set_var("DOOOOM_TEST_VAR", "C:\\somewhere");
        assert_eq!(
            expand_env("%DOOOOM_TEST_VAR%\\Documents"),
            "C:\\somewhere\\Documents"
        );
    }

    #[test]
    fn leaves_unknown_vars_visible() {
        // A blanked-out variable would look like a plausible relative path; a visible
        // %NAME% is obviously wrong on screen.
        assert_eq!(expand_env("%NO_SUCH_VAR_HERE%\\x"), "%NO_SUCH_VAR_HERE%\\x");
    }

    #[test]
    fn handles_unbalanced_percent() {
        assert_eq!(expand_env("100% done"), "100% done");
        assert_eq!(expand_env("plain"), "plain");
    }

    #[test]
    fn spots_onedrive_paths() {
        assert!(looks_like_one_drive(Path::new(
            r"C:\Users\x\OneDrive\Documents"
        )));
        assert!(!looks_like_one_drive(Path::new(r"C:\Users\x\Documents")));
    }
}
