//! Applying a version, and putting it back.
//!
//! The rule the whole module is built around: **never destructive**. A paint can be hours of
//! work, so before a single byte is written every file the apply could touch is copied into
//! `<library>/.backups/<car>/<timestamp>/` with a manifest. Each texture is then written to a
//! temporary name and renamed into place, so a failed or locked copy leaves the previous file
//! intact rather than a half-written one. If anything fails partway, what was already
//! replaced is rolled back from the backup before the error is reported.
//!
//! The `.mip` cleanup is deliberately narrow. The sim cooks `<role>_<id>.mip` next to each
//! `.tga`, and a stale one keeps the old texture on screen — but the folder also holds cooked
//! files for every driver Trading Paints has downloaded. Only this customer's are removed.
//! Clearing the rest is an explicit opt-in, because it costs everyone else a re-cook.

use crate::digest;
use crate::error::{AppError, Result};
use crate::library::{self, Version};
use crate::process;
use crate::roles;
use crate::tradingpaints;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRequest {
    pub paint_dir: String,
    pub library_root: String,
    pub car_folder: String,
    pub sim_folder: String,
    pub version_id: String,
    pub customer_id: String,
    /// A paint can be installed with or without its spec map.
    #[serde(default = "yes")]
    pub include_spec: bool,
    /// Read-only defeats Trading Paints overwriting your car, at the cost of needing to be
    /// cleared again next time. Off by default; the app always clears it before writing.
    #[serde(default)]
    pub set_read_only_after: bool,
    /// Also delete other drivers' cooked `.mip` files. Off by default.
    #[serde(default)]
    pub clear_other_cooked: bool,
    /// Proceed despite the pre-flight guards.
    #[serde(default)]
    pub force: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub kind: String,
    pub detail: String,
}

impl Action {
    fn new(kind: &str, detail: impl Into<String>) -> Self {
        Action {
            kind: kind.to_string(),
            detail: detail.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyReport {
    pub applied: bool,
    pub backup_dir: Option<String>,
    pub actions: Vec<Action>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackedUpFile {
    pub file_name: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub car_folder: String,
    pub sim_folder: String,
    pub customer_id: String,
    pub created: String,
    pub reason: String,
    pub files: Vec<BackedUpFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub id: String,
    pub path: String,
    pub created: String,
    pub reason: String,
    pub file_count: usize,
}

/// Reasons an apply should stop and ask. Returned to the UI so it can offer "keep going".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preflight {
    pub blockers: Vec<String>,
    pub warnings: Vec<String>,
}

/// What stands between the user and a safe apply, right now.
pub fn preflight(paint_dir: &Path, sim_folder: &str) -> Preflight {
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();

    let sim = process::sim_state();
    if sim.sim_running {
        // The sim holds textures open; a copy can fail with the old file already gone.
        blockers.push(
            "iRacing is running. It holds paint files open, so a swap can fail halfway. \
             Close the sim first."
                .to_string(),
        );
    } else if sim.ui_running {
        warnings.push(
            "The iRacing launcher is open. That is harmless now, but starting a session will \
             lock these files."
                .to_string(),
        );
    }

    let tp = tradingpaints::inspect();
    if tp.running {
        blockers.extend(tp.warnings.iter().cloned());
    } else {
        warnings.extend(tp.warnings.iter().cloned());
    }

    if !paint_dir.join(sim_folder).is_dir() {
        blockers.push(format!(
            "There is no {sim_folder} folder in the paint directory. The sim creates it the \
             first time you drive the car."
        ));
    }

    Preflight { blockers, warnings }
}

fn timestamp() -> String {
    // Milliseconds, not seconds: an apply and the safety backup a revert takes can land in
    // the same second, and a shared folder name means the second backup overwrites the
    // first — destroying the only copy of what the user was trying to get back to.
    // Fixed width throughout, so sorting these names is sorting by time.
    chrono::Local::now()
        .format("%Y-%m-%d_%H%M%S_%3f")
        .to_string()
}

fn backup_root(library_root: &Path, car_folder: &str) -> PathBuf {
    library_root.join(library::BACKUP_DIR).join(car_folder)
}

/// Create a backup directory that is certainly new.
///
/// `create_dir` fails rather than succeeding silently when the path is taken, which is what
/// makes this safe against a collision instead of merely unlikely to hit one.
fn new_backup_dir(root: &Path) -> Result<PathBuf> {
    std::fs::create_dir_all(root)?;
    let stamp = timestamp();
    for attempt in 0..100 {
        let name = if attempt == 0 {
            stamp.clone()
        } else {
            format!("{stamp}-{attempt:02}")
        };
        let dir = root.join(&name);
        match std::fs::create_dir(&dir) {
            Ok(()) => return Ok(dir),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(AppError::Io(e)),
        }
    }
    Err(AppError::other(
        "Could not create a backup folder; 100 names in the same millisecond were taken.",
    ))
}

/// Copy every file this customer owns in the car's folder into a timestamped backup.
///
/// Both `.tga` and `.mip` are taken: the cooked files are about to be deleted, and a revert
/// that restored the source but not the cache would leave the sim showing the wrong texture.
fn back_up(
    paint_dir: &Path,
    library_root: &Path,
    car_folder: &str,
    sim_folder: &str,
    customer_id: &str,
    reason: &str,
) -> Result<(PathBuf, Vec<String>)> {
    let source_dir = paint_dir.join(sim_folder);
    let dest = new_backup_dir(&backup_root(library_root, car_folder))?;

    let mut files = Vec::new();
    let mut names = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&source_dir) {
        for entry in entries.flatten() {
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            let Some((_, id, _)) = roles::parse_installed(&name) else {
                continue;
            };
            if id != customer_id {
                continue;
            }
            let from = entry.path();
            std::fs::copy(&from, dest.join(&name))?;
            files.push(BackedUpFile {
                size: std::fs::metadata(&from).map(|m| m.len()).unwrap_or(0),
                sha256: digest::file_sha256(&from).unwrap_or_default(),
                file_name: name.clone(),
            });
            names.push(name);
        }
    }

    let manifest = Manifest {
        car_folder: car_folder.to_string(),
        sim_folder: sim_folder.to_string(),
        customer_id: customer_id.to_string(),
        created: chrono::Local::now().to_rfc3339(),
        reason: reason.to_string(),
        files,
    };
    std::fs::write(
        dest.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )?;

    Ok((dest, names))
}

/// Clear the read-only flag so a write can land. Missing files are not an error.
///
/// clippy dislikes `set_readonly(false)` because on Unix it opens the file to everyone.
/// This app is Windows-only, where it clears exactly one attribute — the one that would
/// otherwise make the copy fail — and leaves the ACL alone.
#[allow(clippy::permissions_set_readonly_false)]
fn clear_read_only(path: &Path) -> Result<bool> {
    let Ok(md) = std::fs::metadata(path) else {
        return Ok(false);
    };
    if !md.permissions().readonly() {
        return Ok(false);
    }
    let mut perms = md.permissions();
    perms.set_readonly(false);
    std::fs::set_permissions(path, perms)?;
    Ok(true)
}

fn set_read_only(path: &Path) -> Result<()> {
    let md = std::fs::metadata(path)?;
    let mut perms = md.permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(path, perms)?;
    Ok(())
}

/// Copy `from` into place at `to` via a temporary name, so `to` is either the old file or
/// the new one and never a half-written mixture.
fn install_file(from: &Path, to: &Path) -> Result<()> {
    let tmp = to.with_extension("doooom-tmp");
    // A leftover temp from a previous crash would make the copy fail.
    let _ = std::fs::remove_file(&tmp);
    std::fs::copy(from, &tmp)?;
    clear_read_only(to)?;
    match std::fs::rename(&tmp, to) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(AppError::Io(e))
        }
    }
}

/// Put back the files named in `names` from `backup_dir`, best effort.
fn restore_from(backup_dir: &Path, target_dir: &Path, names: &[String]) -> Vec<String> {
    let mut failures = Vec::new();
    for name in names {
        let from = backup_dir.join(name);
        if !from.is_file() {
            continue;
        }
        let to = target_dir.join(name);
        let _ = clear_read_only(&to);
        if let Err(e) = std::fs::copy(&from, &to) {
            failures.push(format!("{name}: {e}"));
        }
    }
    failures
}

/// Apply a version to the sim's folder.
pub fn apply(req: &ApplyRequest, version: &Version) -> Result<ApplyReport> {
    let paint_dir = PathBuf::from(&req.paint_dir);
    let library_root = PathBuf::from(&req.library_root);
    let target_dir = paint_dir.join(&req.sim_folder);

    if !crate::customer::is_valid(&req.customer_id) {
        return Err(AppError::refused(
            "The customer id must be digits only. Nothing was changed.",
        ));
    }

    let pre = preflight(&paint_dir, &req.sim_folder);
    if !pre.blockers.is_empty() && !req.force {
        return Err(AppError::refused(pre.blockers.join(" ")));
    }

    let to_install: Vec<_> = version
        .files
        .iter()
        .filter(|f| req.include_spec || f.role != "car_spec")
        .collect();
    if to_install.is_empty() {
        return Err(AppError::refused(
            "This version has no textures to install. Nothing was changed.",
        ));
    }
    if !to_install.iter().any(|f| f.role == "car") {
        return Err(AppError::refused(
            "This version has no car paint. Nothing was changed.",
        ));
    }

    let mut actions = Vec::new();
    let mut warnings = pre.warnings.clone();
    if !pre.blockers.is_empty() {
        warnings.extend(
            pre.blockers
                .iter()
                .map(|b| format!("Applied anyway, over a warning: {b}")),
        );
    }

    // 1. Back up before anything is touched.
    let (backup_dir, backed_up) = back_up(
        &paint_dir,
        &library_root,
        &req.car_folder,
        &req.sim_folder,
        &req.customer_id,
        &format!("apply {}", req.version_id),
    )?;
    actions.push(Action::new(
        "backup",
        format!(
            "{} file{} backed up to {}",
            backed_up.len(),
            if backed_up.len() == 1 { "" } else { "s" },
            backup_dir.display()
        ),
    ));

    // 2. Install each texture, rolling back everything if one fails.
    let mut written: Vec<String> = Vec::new();
    for file in &to_install {
        let dest_name = roles::installed_name(&file.role, &req.customer_id, roles::TEXTURE_EXT);
        let dest = target_dir.join(&dest_name);
        match install_file(Path::new(&file.path), &dest) {
            Ok(()) => {
                actions.push(Action::new(
                    "install",
                    format!("{} -> {dest_name}", file.file_name),
                ));
                written.push(dest_name);
            }
            Err(e) => {
                let failures = restore_from(&backup_dir, &target_dir, &backed_up);
                digest::clear_cache();
                let mut msg = format!(
                    "Could not write {dest_name} ({e}). Everything this apply had changed was \
                     put back from {}.",
                    backup_dir.display()
                );
                if !failures.is_empty() {
                    msg.push_str(&format!(
                        " Some files could not be restored automatically: {}. The backup is \
                         still on disk.",
                        failures.join(", ")
                    ));
                }
                return Err(AppError::refused(msg));
            }
        }
    }

    // 3. Clear the cooked cache, or the sim keeps serving the old texture.
    let mut cleared = 0usize;
    let mut left_alone = 0usize;
    if let Ok(entries) = std::fs::read_dir(&target_dir) {
        for entry in entries.flatten() {
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            let Some((_, id, ext)) = roles::parse_installed(&name) else {
                continue;
            };
            if ext != roles::COOKED_EXT {
                continue;
            }
            let mine = id == req.customer_id;
            if !mine && !req.clear_other_cooked {
                left_alone += 1;
                continue;
            }
            let path = entry.path();
            let _ = clear_read_only(&path);
            match std::fs::remove_file(&path) {
                Ok(()) => cleared += 1,
                Err(e) => warnings.push(format!("Could not delete cooked file {name}: {e}")),
            }
        }
    }
    actions.push(Action::new(
        "cooked",
        format!(
            "{cleared} cooked .mip file{} deleted so the sim re-cooks",
            if cleared == 1 { "" } else { "s" }
        ),
    ));
    if left_alone > 0 {
        actions.push(Action::new(
            "cooked-kept",
            format!("{left_alone} cooked file(s) belonging to other drivers left alone"),
        ));
    }

    // 4. Optionally lock the result against Trading Paints.
    if req.set_read_only_after {
        for name in &written {
            match set_read_only(&target_dir.join(name)) {
                Ok(()) => {}
                Err(e) => warnings.push(format!("Could not set {name} read-only: {e}")),
            }
        }
        actions.push(Action::new(
            "read-only",
            format!("{} installed file(s) set read-only", written.len()),
        ));
    }

    if !req.include_spec && version.has_spec {
        warnings.push(
            "The spec map was not installed. Any spec map already in the folder is still \
             there and will be used with this paint."
                .to_string(),
        );
    }

    digest::clear_cache();
    Ok(ApplyReport {
        applied: true,
        backup_dir: Some(backup_dir.to_string_lossy().to_string()),
        actions,
        warnings,
    })
}

/// Backups for one car, newest first.
pub fn list_backups(library_root: &Path, car_folder: &str) -> Result<Vec<BackupEntry>> {
    let root = backup_root(library_root, car_folder);
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&root)?.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let path = entry.path();
        let id = entry.file_name().to_string_lossy().to_string();
        let manifest: Option<Manifest> = std::fs::read_to_string(path.join("manifest.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok());
        let (created, reason, count) = match manifest {
            Some(m) => (m.created, m.reason, m.files.len()),
            None => (id.clone(), "unknown".to_string(), 0),
        };
        out.push(BackupEntry {
            id,
            path: path.to_string_lossy().to_string(),
            created,
            reason,
            file_count: count,
        });
    }
    // Folder names are timestamps, so this is newest-first.
    out.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(out)
}

/// Put a backup back.
///
/// Files the backup does not contain but that belong to this customer were added by the
/// apply being undone, so they are removed — after being backed up themselves, which makes
/// a revert undoable in its own right.
pub fn revert(
    paint_dir: &Path,
    library_root: &Path,
    car_folder: &str,
    sim_folder: &str,
    customer_id: &str,
    backup_id: Option<&str>,
    force: bool,
) -> Result<ApplyReport> {
    let backups = list_backups(library_root, car_folder)?;
    let chosen = match backup_id {
        Some(id) => backups.iter().find(|b| b.id == id),
        None => backups.first(),
    }
    .ok_or_else(|| AppError::refused("There is no backup to go back to for this car."))?;

    let pre = preflight(paint_dir, sim_folder);
    if !pre.blockers.is_empty() && !force {
        return Err(AppError::refused(pre.blockers.join(" ")));
    }

    let backup_dir = PathBuf::from(&chosen.path);
    let target_dir = paint_dir.join(sim_folder);
    let mut actions = Vec::new();
    let mut warnings = pre.warnings.clone();

    // Reverting overwrites the current state, so take a backup of that first.
    let (safety_dir, _) = back_up(
        paint_dir,
        library_root,
        car_folder,
        sim_folder,
        customer_id,
        &format!("before revert to {}", chosen.id),
    )?;
    actions.push(Action::new(
        "backup",
        format!("current files backed up to {} first", safety_dir.display()),
    ));

    let mut restored: Vec<String> = Vec::new();
    for entry in std::fs::read_dir(&backup_dir)?.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if roles::parse_installed(&name).is_none() {
            continue; // manifest.json and anything else that is not a texture
        }
        let dest = target_dir.join(&name);
        match install_file(&entry.path(), &dest) {
            Ok(()) => {
                actions.push(Action::new("restore", name.clone()));
                restored.push(name);
            }
            Err(e) => warnings.push(format!("Could not restore {name}: {e}")),
        }
    }

    // Remove this customer's files that the backup did not have.
    let mut removed = 0usize;
    if let Ok(entries) = std::fs::read_dir(&target_dir) {
        for entry in entries.flatten() {
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            let Some((_, id, _)) = roles::parse_installed(&name) else {
                continue;
            };
            if id != customer_id || restored.contains(&name) {
                continue;
            }
            let path = entry.path();
            let _ = clear_read_only(&path);
            match std::fs::remove_file(&path) {
                Ok(()) => removed += 1,
                Err(e) => warnings.push(format!("Could not remove {name}: {e}")),
            }
        }
    }
    if removed > 0 {
        actions.push(Action::new(
            "remove",
            format!("{removed} file(s) added since that backup were removed"),
        ));
    }

    digest::clear_cache();
    Ok(ApplyReport {
        applied: true,
        backup_dir: Some(chosen.path.clone()),
        actions,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::{Meta, VersionFile};

    struct Fixture {
        root: PathBuf,
        paint: PathBuf,
        library: PathBuf,
    }

    fn fixture(tag: &str) -> Fixture {
        let root = std::env::temp_dir().join(format!("doooom-apply-{tag}"));
        let _ = std::fs::remove_dir_all(&root);
        let paint = root.join("paint");
        let library = root.join("library");
        std::fs::create_dir_all(paint.join("lotus79")).unwrap();
        std::fs::create_dir_all(library.join("lotus79").join("v13")).unwrap();
        Fixture {
            root,
            paint,
            library,
        }
    }

    fn make_version(fx: &Fixture, paint_bytes: &[u8], spec_bytes: Option<&[u8]>) -> Version {
        let dir = fx.library.join("lotus79").join("v13");
        let mut files = Vec::new();
        let p = dir.join("car_1159839.tga");
        std::fs::write(&p, paint_bytes).unwrap();
        files.push(VersionFile {
            role: "car".into(),
            role_label: "Paint".into(),
            file_name: "car_1159839.tga".into(),
            path: p.to_string_lossy().to_string(),
            size: paint_bytes.len() as u64,
            sha256: digest::file_sha256(&p).unwrap(),
        });
        if let Some(spec) = spec_bytes {
            let s = dir.join("car_spec_1159839.tga");
            std::fs::write(&s, spec).unwrap();
            files.push(VersionFile {
                role: "car_spec".into(),
                role_label: "Spec map".into(),
                file_name: "car_spec_1159839.tga".into(),
                path: s.to_string_lossy().to_string(),
                size: spec.len() as u64,
                sha256: digest::file_sha256(&s).unwrap(),
            });
        }
        Version {
            id: "v13".into(),
            name: "v13".into(),
            path: dir.to_string_lossy().to_string(),
            has_paint: true,
            has_spec: spec_bytes.is_some(),
            files,
            previews: vec![],
            meta: Meta::default(),
            problems: vec![],
        }
    }

    fn request(fx: &Fixture) -> ApplyRequest {
        ApplyRequest {
            paint_dir: fx.paint.to_string_lossy().to_string(),
            library_root: fx.library.to_string_lossy().to_string(),
            car_folder: "lotus79".into(),
            sim_folder: "lotus79".into(),
            version_id: "v13".into(),
            customer_id: "1159839".into(),
            include_spec: true,
            set_read_only_after: false,
            clear_other_cooked: false,
            // The test machine may well have iRacing or the downloader running.
            force: true,
        }
    }

    #[test]
    fn applies_renames_and_backs_up() {
        let fx = fixture("basic");
        let car = fx.paint.join("lotus79");
        std::fs::write(car.join("car_1159839.tga"), b"OLD PAINT").unwrap();

        let version = make_version(&fx, b"NEW PAINT", Some(b"NEW SPEC"));
        let report = apply(&request(&fx), &version).unwrap();
        assert!(report.applied);

        // Installed under the customer id, both roles.
        assert_eq!(
            std::fs::read(car.join("car_1159839.tga")).unwrap(),
            b"NEW PAINT"
        );
        assert_eq!(
            std::fs::read(car.join("car_spec_1159839.tga")).unwrap(),
            b"NEW SPEC"
        );

        // The old paint survived, in the backup.
        let backup = PathBuf::from(report.backup_dir.unwrap());
        assert_eq!(
            std::fs::read(backup.join("car_1159839.tga")).unwrap(),
            b"OLD PAINT"
        );
        assert!(backup.join("manifest.json").is_file());

        std::fs::remove_dir_all(&fx.root).ok();
    }

    #[test]
    fn deletes_only_this_customers_cooked_files() {
        // The folder is full of other drivers' cooked textures; clearing them all would
        // cost everyone a re-cook.
        let fx = fixture("mips");
        let car = fx.paint.join("lotus79");
        std::fs::write(car.join("car_1159839.mip"), b"mine").unwrap();
        std::fs::write(car.join("car_spec_1159839.mip"), b"mine too").unwrap();
        std::fs::write(car.join("car_999000.mip"), b"someone else").unwrap();

        let version = make_version(&fx, b"NEW", None);
        apply(&request(&fx), &version).unwrap();

        assert!(!car.join("car_1159839.mip").exists());
        assert!(!car.join("car_spec_1159839.mip").exists());
        assert!(
            car.join("car_999000.mip").exists(),
            "another driver's cooked file must be left alone"
        );

        std::fs::remove_dir_all(&fx.root).ok();
    }

    #[test]
    fn opt_in_clears_every_cooked_file() {
        let fx = fixture("mips-all");
        let car = fx.paint.join("lotus79");
        std::fs::write(car.join("car_999000.mip"), b"someone else").unwrap();

        let mut req = request(&fx);
        req.clear_other_cooked = true;
        let version = make_version(&fx, b"NEW", None);
        apply(&req, &version).unwrap();

        assert!(!car.join("car_999000.mip").exists());
        std::fs::remove_dir_all(&fx.root).ok();
    }

    #[test]
    fn read_only_targets_are_cleared_then_written() {
        let fx = fixture("readonly");
        let car = fx.paint.join("lotus79");
        let target = car.join("car_1159839.tga");
        std::fs::write(&target, b"OLD").unwrap();
        set_read_only(&target).unwrap();

        let version = make_version(&fx, b"NEW", None);
        apply(&request(&fx), &version).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"NEW");

        std::fs::remove_dir_all(&fx.root).ok();
    }

    #[test]
    fn can_relock_after_applying() {
        let fx = fixture("relock");
        let mut req = request(&fx);
        req.set_read_only_after = true;
        let version = make_version(&fx, b"NEW", None);
        apply(&req, &version).unwrap();

        let target = fx.paint.join("lotus79").join("car_1159839.tga");
        assert!(std::fs::metadata(&target).unwrap().permissions().readonly());

        // And a later apply must still be able to write over it.
        let version2 = make_version(&fx, b"NEWER", None);
        apply(&request(&fx), &version2).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"NEWER");

        std::fs::remove_dir_all(&fx.root).ok();
    }

    #[test]
    fn skipping_the_spec_map_warns_that_the_old_one_remains() {
        let fx = fixture("nospec");
        let car = fx.paint.join("lotus79");
        std::fs::write(car.join("car_spec_1159839.tga"), b"OLD SPEC").unwrap();

        let mut req = request(&fx);
        req.include_spec = false;
        let version = make_version(&fx, b"NEW", Some(b"NEW SPEC"));
        let report = apply(&req, &version).unwrap();

        assert_eq!(
            std::fs::read(car.join("car_spec_1159839.tga")).unwrap(),
            b"OLD SPEC"
        );
        assert!(report.warnings.iter().any(|w| w.contains("spec map")));
        std::fs::remove_dir_all(&fx.root).ok();
    }

    #[test]
    fn a_bad_customer_id_changes_nothing() {
        let fx = fixture("badid");
        let mut req = request(&fx);
        req.customer_id = "not-digits".into();
        let version = make_version(&fx, b"NEW", None);

        assert!(apply(&req, &version).is_err());
        assert!(!fx.paint.join("lotus79").join("car_not-digits.tga").exists());
        std::fs::remove_dir_all(&fx.root).ok();
    }

    #[test]
    fn revert_restores_and_removes_what_the_apply_added() {
        let fx = fixture("revert");
        let car = fx.paint.join("lotus79");
        std::fs::write(car.join("car_1159839.tga"), b"ORIGINAL").unwrap();

        // Apply adds a spec map that was not there before.
        let version = make_version(&fx, b"NEW PAINT", Some(b"NEW SPEC"));
        apply(&request(&fx), &version).unwrap();
        assert!(car.join("car_spec_1159839.tga").exists());

        let report = revert(
            &fx.paint,
            &fx.library,
            "lotus79",
            "lotus79",
            "1159839",
            None,
            true,
        )
        .unwrap();
        assert!(report.applied);

        assert_eq!(
            std::fs::read(car.join("car_1159839.tga")).unwrap(),
            b"ORIGINAL"
        );
        assert!(
            !car.join("car_spec_1159839.tga").exists(),
            "a spec map the apply introduced should not survive the revert"
        );

        std::fs::remove_dir_all(&fx.root).ok();
    }

    #[test]
    fn revert_is_itself_undoable() {
        let fx = fixture("revert-twice");
        let car = fx.paint.join("lotus79");
        std::fs::write(car.join("car_1159839.tga"), b"ORIGINAL").unwrap();

        let version = make_version(&fx, b"NEW", None);
        apply(&request(&fx), &version).unwrap();
        revert(&fx.paint, &fx.library, "lotus79", "lotus79", "1159839", None, true).unwrap();

        // Two backups now: the apply's, and the one the revert took first.
        let backups = list_backups(&fx.library, "lotus79").unwrap();
        assert!(backups.len() >= 2);
        assert!(backups[0].reason.starts_with("before revert"));

        std::fs::remove_dir_all(&fx.root).ok();
    }

    #[test]
    fn back_to_back_backups_never_share_a_folder() {
        // Two backups in the same second used to land in one folder, so the second wiped
        // the first. An apply immediately followed by a revert does exactly that, and the
        // only copy of the original paint was what got overwritten.
        let fx = fixture("collide");
        let car = fx.paint.join("lotus79");
        std::fs::write(car.join("car_1159839.tga"), b"ORIGINAL").unwrap();

        let root = fx.library.join(library::BACKUP_DIR).join("lotus79");
        let mut seen = std::collections::BTreeSet::new();
        for _ in 0..20 {
            let (dir, _) = back_up(
                &fx.paint,
                &fx.library,
                "lotus79",
                "lotus79",
                "1159839",
                "stress",
            )
            .unwrap();
            assert!(seen.insert(dir.clone()), "reused backup folder {dir:?}");
        }
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 20);

        std::fs::remove_dir_all(&fx.root).ok();
    }

    #[test]
    fn backups_sort_newest_first() {
        let fx = fixture("sort");
        std::fs::write(fx.paint.join("lotus79").join("car_1159839.tga"), b"x").unwrap();
        for i in 0..5 {
            back_up(
                &fx.paint,
                &fx.library,
                "lotus79",
                "lotus79",
                "1159839",
                &format!("run {i}"),
            )
            .unwrap();
        }
        let listed = list_backups(&fx.library, "lotus79").unwrap();
        assert_eq!(listed.len(), 5);
        assert_eq!(listed[0].reason, "run 4", "newest backup must come first");
        std::fs::remove_dir_all(&fx.root).ok();
    }

    #[test]
    fn revert_with_no_backup_refuses() {
        let fx = fixture("norevert");
        let err = revert(
            &fx.paint,
            &fx.library,
            "lotus79",
            "lotus79",
            "1159839",
            None,
            true,
        );
        assert!(err.is_err());
        std::fs::remove_dir_all(&fx.root).ok();
    }

    #[test]
    fn a_missing_source_file_rolls_the_apply_back() {
        let fx = fixture("rollback");
        let car = fx.paint.join("lotus79");
        std::fs::write(car.join("car_1159839.tga"), b"ORIGINAL").unwrap();

        // Paint is fine, spec points at a file that is not there.
        let mut version = make_version(&fx, b"NEW PAINT", Some(b"NEW SPEC"));
        version.files[1].path = fx.root.join("gone.tga").to_string_lossy().to_string();

        let err = apply(&request(&fx), &version).unwrap_err();
        assert!(matches!(err, AppError::Refused(_)));

        // The paint that was already swapped must be back to what it was.
        assert_eq!(
            std::fs::read(car.join("car_1159839.tga")).unwrap(),
            b"ORIGINAL",
            "a partial apply must not leave the new paint in place"
        );

        std::fs::remove_dir_all(&fx.root).ok();
    }

    #[test]
    fn no_temp_files_survive_a_failed_apply() {
        let fx = fixture("tmp");
        let car = fx.paint.join("lotus79");
        std::fs::write(car.join("car_1159839.tga"), b"ORIGINAL").unwrap();

        let mut version = make_version(&fx, b"NEW", Some(b"SPEC"));
        version.files[1].path = fx.root.join("gone.tga").to_string_lossy().to_string();
        let _ = apply(&request(&fx), &version);

        let leftovers: Vec<_> = std::fs::read_dir(&car)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("doooom-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files were left behind");

        std::fs::remove_dir_all(&fx.root).ok();
    }
}
