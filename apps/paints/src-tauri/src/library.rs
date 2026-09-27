//! The library: versions of a paint, kept outside the sim's folders.
//!
//! ```text
//! <library>/<car folder>/<version>/
//!     car.tga | car_<id>.tga          paint
//!     car_spec.tga | car_spec_<id>.tga  spec map, optional
//!     preview*.png                    optional
//!     meta.json                       optional
//! ```
//!
//! Both filename shapes are accepted on purpose. The plan describes role-only names; the
//! design pipeline that feeds this app already writes `car_1159839.tga`, and asking it to
//! change would be the tail wagging the dog.

use crate::digest;
use crate::error::Result;
use crate::roles;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The library folder older versions of this app wrote backups into. Backups now live in the
/// app's own data directory — inside a git checkout they made the repo permanently dirty — but
/// a library may still carry one, and it is not a car.
pub const LEGACY_BACKUP_DIR: &str = ".backups";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionFile {
    pub role: String,
    pub role_label: String,
    pub file_name: String,
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Meta {
    pub name: Option<String>,
    pub created: Option<String>,
    pub notes: Option<String>,
    pub source: Option<String>,
    pub seed: Option<String>,
    /// Override for the sim folder this car installs into, when the library folder name
    /// and the sim's own name disagree.
    pub sim_folder: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    /// Folder name, and the stable key the front end uses.
    pub id: String,
    /// `meta.name` when set, else the folder name.
    pub name: String,
    pub path: String,
    pub files: Vec<VersionFile>,
    pub previews: Vec<String>,
    pub meta: Meta,
    pub has_paint: bool,
    pub has_spec: bool,
    /// Anything odd about this version that the user should see rather than hit later.
    pub problems: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Car {
    /// Folder name inside the library.
    pub folder: String,
    /// The sim's own folder name, resolved against the paint directory when possible.
    pub sim_folder: Option<String>,
    /// True when the sim folder was matched loosely (`mx5-mx52016` -> `mx5 mx52016`).
    pub sim_folder_inferred: bool,
    pub versions: Vec<Version>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub root: String,
    pub cars: Vec<Car>,
    pub notes: Vec<String>,
}

/// Fold a folder name down to something comparable. The library uses `mx5-mx52016` while
/// the sim uses `mx5 mx52016`, and neither is wrong.
fn normalise(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_space = false;
    for ch in name.trim().chars() {
        let c = if ch == '-' || ch == '_' { ' ' } else { ch };
        if c.is_whitespace() {
            if !last_space && !out.is_empty() {
                out.push(' ');
            }
            last_space = true;
        } else {
            out.extend(c.to_lowercase());
            last_space = false;
        }
    }
    // A trailing space can only come from trailing punctuation; drop it.
    while out.ends_with(' ') {
        out.pop();
    }
    out
}

/// Match a library car folder to the sim's folder for that car.
///
/// Returns `(sim_folder, inferred)` where `inferred` marks a loose match, so the UI can say
/// so instead of quietly installing into a folder the user did not name.
pub fn resolve_sim_folder(
    library_folder: &str,
    meta_override: Option<&str>,
    paint_dir: Option<&Path>,
) -> (Option<String>, bool) {
    if let Some(explicit) = meta_override.filter(|s| !s.trim().is_empty()) {
        return (Some(explicit.to_string()), false);
    }
    let Some(paint_dir) = paint_dir else {
        return (None, false);
    };
    let Ok(entries) = std::fs::read_dir(paint_dir) else {
        return (None, false);
    };
    let sim_dirs: Vec<String> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .collect();

    if let Some(exact) = sim_dirs.iter().find(|d| d.as_str() == library_folder) {
        return (Some(exact.clone()), false);
    }
    let target = normalise(library_folder);
    if let Some(loose) = sim_dirs.iter().find(|d| normalise(d) == target) {
        let inferred = loose.as_str() != library_folder;
        return (Some(loose.clone()), inferred);
    }
    (None, false)
}

fn read_meta(version_dir: &Path) -> (Meta, Option<String>) {
    let path = version_dir.join("meta.json");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return (Meta::default(), None);
    };
    match serde_json::from_str::<Meta>(&text) {
        Ok(m) => (m, None),
        // A malformed meta.json must not hide the paint files next to it.
        Err(e) => (
            Meta::default(),
            Some(format!("meta.json could not be read ({e}); ignoring it.")),
        ),
    }
}

fn scan_version(dir: &Path) -> Result<Version> {
    let id = dir
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string();

    let (meta, meta_problem) = read_meta(dir);
    let mut files = Vec::new();
    let mut previews = Vec::new();
    let mut problems: Vec<String> = meta_problem.into_iter().collect();

    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)?
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.path())
        .collect();
    entries.sort();

    for path in entries {
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if let Some(role) = roles::parse_library_file(name) {
            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            match digest::file_sha256(&path) {
                Ok(sha256) => files.push(VersionFile {
                    role: role.to_string(),
                    role_label: roles::role_label(role).to_string(),
                    file_name: name.to_string(),
                    path: path.to_string_lossy().to_string(),
                    size,
                    sha256,
                }),
                Err(e) => problems.push(format!("{name} could not be read ({e}).")),
            }
        } else if name.to_ascii_lowercase().ends_with(".png") {
            previews.push(path.to_string_lossy().to_string());
        }
    }

    // Two files claiming the same role would make the install order decide the outcome.
    for role in roles::CAR_ROLES {
        let n = files.iter().filter(|f| f.role == *role).count();
        if n > 1 {
            problems.push(format!(
                "{n} files in this version claim the {} role; only one can be installed.",
                roles::role_label(role)
            ));
        }
    }

    let has_paint = files.iter().any(|f| f.role == "car");
    let has_spec = files.iter().any(|f| f.role == "car_spec");
    if !has_paint {
        problems.push("No car paint (car.tga) in this version.".to_string());
    }

    let name = meta
        .name
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| id.clone());

    Ok(Version {
        id,
        name,
        path: dir.to_string_lossy().to_string(),
        files,
        previews,
        meta,
        has_paint,
        has_spec,
        problems,
    })
}

/// Walk `<library>/<car>/<version>`.
pub fn scan(root: &Path, paint_dir: Option<&Path>) -> Result<Library> {
    let mut cars = Vec::new();
    let mut notes = Vec::new();

    if !root.is_dir() {
        notes.push(format!("{} is not a folder.", root.display()));
        return Ok(Library {
            root: root.to_string_lossy().to_string(),
            cars,
            notes,
        });
    }

    let mut car_dirs: Vec<PathBuf> = std::fs::read_dir(root)?
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.path())
        .filter(|p| {
            // LEGACY_BACKUP_DIR is ours, and dotfolders are never cars.
            !p.file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.starts_with('.'))
                .unwrap_or(true)
        })
        .collect();
    car_dirs.sort();

    for car_dir in car_dirs {
        let folder = car_dir
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();

        let mut version_dirs: Vec<PathBuf> = std::fs::read_dir(&car_dir)?
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .map(|e| e.path())
            .collect();
        version_dirs.sort();

        let mut versions = Vec::new();
        for v in version_dirs {
            match scan_version(&v) {
                Ok(version) => versions.push(version),
                Err(e) => notes.push(format!("{} could not be read ({e}).", v.display())),
            }
        }
        if versions.is_empty() {
            continue;
        }

        // A sim-folder override on any version applies to the car.
        let override_name = versions
            .iter()
            .find_map(|v| v.meta.sim_folder.as_deref())
            .map(str::to_string);
        let (sim_folder, inferred) =
            resolve_sim_folder(&folder, override_name.as_deref(), paint_dir);
        if sim_folder.is_none() && paint_dir.is_some() {
            notes.push(format!(
                "No folder named {folder} in the sim's paint directory. The sim creates a \
                 car's folder the first time you drive it."
            ));
        }

        cars.push(Car {
            folder,
            sim_folder,
            sim_folder_inferred: inferred,
            versions,
        });
    }

    Ok(Library {
        root: root.to_string_lossy().to_string(),
        cars,
        notes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalises_separator_differences() {
        // The exact case in the wild.
        assert_eq!(normalise("mx5-mx52016"), normalise("mx5 mx52016"));
        assert_eq!(normalise("Lotus79"), "lotus79");
        assert_eq!(normalise("astonmartin  dbr9"), "astonmartin dbr9");
        assert_eq!(normalise(" trailing-"), "trailing");
    }

    #[test]
    fn different_cars_do_not_collide() {
        assert_ne!(normalise("audir8gt3"), normalise("audir8lmsevo2gt3"));
    }

    #[test]
    fn meta_override_wins_and_is_not_inferred() {
        let (folder, inferred) = resolve_sim_folder("whatever", Some("mx5 mx52016"), None);
        assert_eq!(folder.as_deref(), Some("mx5 mx52016"));
        assert!(!inferred);
    }

    #[test]
    fn loose_match_is_flagged_as_inferred() {
        let root = std::env::temp_dir().join("doooom-lib-resolve");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("mx5 mx52016")).unwrap();
        std::fs::create_dir_all(root.join("lotus79")).unwrap();

        let (folder, inferred) = resolve_sim_folder("mx5-mx52016", None, Some(&root));
        assert_eq!(folder.as_deref(), Some("mx5 mx52016"));
        assert!(inferred, "a renamed match must be reported as inferred");

        let (exact, inferred) = resolve_sim_folder("lotus79", None, Some(&root));
        assert_eq!(exact.as_deref(), Some("lotus79"));
        assert!(!inferred);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn scans_the_shape_the_pipeline_writes() {
        let root = std::env::temp_dir().join("doooom-lib-scan");
        let _ = std::fs::remove_dir_all(&root);
        let v = root.join("lotus79").join("v13-shatter");
        std::fs::create_dir_all(&v).unwrap();
        std::fs::write(v.join("car_1159839.tga"), b"paint").unwrap();
        std::fs::write(v.join("car_spec_1159839.tga"), b"spec").unwrap();
        std::fs::write(v.join("preview_topview_nose_up.png"), b"png").unwrap();

        let lib = scan(&root, None).unwrap();
        assert_eq!(lib.cars.len(), 1);
        let version = &lib.cars[0].versions[0];
        assert!(version.has_paint && version.has_spec);
        assert_eq!(version.previews.len(), 1);
        assert!(version.problems.is_empty(), "{:?}", version.problems);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_version_with_no_paint_says_so() {
        let root = std::env::temp_dir().join("doooom-lib-nopaint");
        let _ = std::fs::remove_dir_all(&root);
        let v = root.join("lotus79").join("broken");
        std::fs::create_dir_all(&v).unwrap();
        std::fs::write(v.join("car_spec.tga"), b"spec").unwrap();

        let lib = scan(&root, None).unwrap();
        let version = &lib.cars[0].versions[0];
        assert!(!version.has_paint);
        assert!(version.problems.iter().any(|p| p.contains("No car paint")));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn backups_folder_is_not_a_car() {
        let root = std::env::temp_dir().join("doooom-lib-backups");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(LEGACY_BACKUP_DIR).join("lotus79").join("x")).unwrap();
        let v = root.join("lotus79").join("v1");
        std::fs::create_dir_all(&v).unwrap();
        std::fs::write(v.join("car.tga"), b"paint").unwrap();

        let lib = scan(&root, None).unwrap();
        assert_eq!(lib.cars.len(), 1);
        assert_eq!(lib.cars[0].folder, "lotus79");

        std::fs::remove_dir_all(&root).ok();
    }
}
