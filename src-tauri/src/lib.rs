//! doooom paints — swap iRacing liveries.
//!
//! The Rust side owns every decision that touches the disk. The front end renders what these
//! commands return and asks for things to happen; it never builds a path or a filename of its
//! own, so the rules about backups, renaming and cooked files live in exactly one place.

pub mod apply;
pub mod customer;
pub mod digest;
pub mod error;
pub mod installed;
pub mod library;
pub mod paths;
pub mod process;
pub mod repo;
pub mod roles;
pub mod settings;
pub mod tradingpaints;

use base64::Engine;
use error::{AppError, Result};
use std::path::{Path, PathBuf};

/// Previews are inlined as data URLs rather than served over the asset protocol, because the
/// library lives wherever the user keeps it and a scope wide enough to cover that is a scope
/// wide enough to cover everything.
const MAX_PREVIEW_BYTES: u64 = 12 * 1024 * 1024;

#[tauri::command]
fn detect_paths() -> paths::PathReport {
    paths::detect()
}

#[tauri::command]
fn detect_customer(paint_dir: String) -> customer::CustomerReport {
    customer::detect(Path::new(&paint_dir))
}

#[tauri::command]
fn scan_library(library_root: String, paint_dir: Option<String>) -> Result<library::Library> {
    let paint = paint_dir.map(PathBuf::from);
    library::scan(Path::new(&library_root), paint.as_deref())
}

/// The installed state of one car, with the applied version worked out by hashing.
#[tauri::command]
fn car_state(
    paint_dir: String,
    library_root: String,
    car_folder: String,
    sim_folder: Option<String>,
    customer_id: String,
) -> Result<installed::InstalledState> {
    let paint = PathBuf::from(&paint_dir);
    let lib = library::scan(Path::new(&library_root), Some(&paint))?;
    let car = lib
        .cars
        .iter()
        .find(|c| c.folder == car_folder)
        .ok_or_else(|| AppError::other(format!("{car_folder} is not in the library.")))?;

    let sim = sim_folder.or_else(|| car.sim_folder.clone());
    let mut state = installed::read(&paint, sim.as_deref(), &customer_id)?;
    installed::identify(&mut state, &car.versions);
    Ok(state)
}

#[tauri::command]
fn trading_paints_status() -> tradingpaints::TradingPaints {
    tradingpaints::inspect()
}

#[tauri::command]
fn sim_status() -> process::SimState {
    process::sim_state()
}

#[tauri::command]
fn preflight(paint_dir: String, sim_folder: String) -> apply::Preflight {
    apply::preflight(Path::new(&paint_dir), &sim_folder)
}

#[tauri::command]
fn apply_version(request: apply::ApplyRequest) -> Result<apply::ApplyReport> {
    let paint = PathBuf::from(&request.paint_dir);
    let lib = library::scan(Path::new(&request.library_root), Some(&paint))?;
    let version = lib
        .cars
        .iter()
        .find(|c| c.folder == request.car_folder)
        .and_then(|c| c.versions.iter().find(|v| v.id == request.version_id))
        .ok_or_else(|| {
            AppError::other(format!(
                "{} / {} is no longer in the library.",
                request.car_folder, request.version_id
            ))
        })?;
    apply::apply(&request, version)
}

#[tauri::command]
fn list_backups(library_root: String, car_folder: String) -> Result<Vec<apply::BackupEntry>> {
    apply::list_backups(Path::new(&library_root), &car_folder)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn revert_car(
    paint_dir: String,
    library_root: String,
    car_folder: String,
    sim_folder: String,
    customer_id: String,
    backup_id: Option<String>,
    force: Option<bool>,
) -> Result<apply::ApplyReport> {
    apply::revert(
        Path::new(&paint_dir),
        Path::new(&library_root),
        &car_folder,
        &sim_folder,
        &customer_id,
        backup_id.as_deref(),
        force.unwrap_or(false),
    )
}

/// Read the library's git checkout without touching the network.
#[tauri::command]
fn repo_status(path: String) -> repo::RepoStatus {
    repo::status(Path::new(&path))
}

/// Ask the remote whether anything is waiting. Transfers no objects.
#[tauri::command]
fn repo_check(path: String) -> Result<repo::RepoStatus> {
    repo::check(Path::new(&path))
}

/// Fast-forward the library to the remote.
#[tauri::command]
fn repo_pull(path: String) -> Result<repo::PullReport> {
    repo::pull(Path::new(&path))
}

/// Libraries findable near the sim, so the common case needs no browsing.
#[tauri::command]
fn suggest_libraries(paint_dir: String) -> Vec<repo::LibrarySuggestion> {
    repo::suggest_libraries(Path::new(&paint_dir))
}

#[tauri::command]
fn load_settings() -> settings::Settings {
    settings::load()
}

#[tauri::command]
fn save_settings(settings: settings::Settings) -> Result<()> {
    settings::save(&settings)
}

/// Read a preview PNG as a data URL.
#[tauri::command]
fn load_preview(path: String) -> Result<String> {
    let p = PathBuf::from(&path);
    let md = std::fs::metadata(&p)?;
    if md.len() > MAX_PREVIEW_BYTES {
        return Err(AppError::other("Preview image is too large to show."));
    }
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => return Err(AppError::other("Previews must be PNG, JPEG or WebP.")),
    };
    let bytes = std::fs::read(&p)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            detect_paths,
            detect_customer,
            scan_library,
            car_state,
            trading_paints_status,
            sim_status,
            preflight,
            apply_version,
            list_backups,
            revert_car,
            repo_status,
            repo_check,
            repo_pull,
            suggest_libraries,
            load_settings,
            save_settings,
            load_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running doooom paints");
}
