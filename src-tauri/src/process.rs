//! Is the sim, or the downloader, holding the paint folder open?
//!
//! `tasklist` is used rather than a process-enumeration crate: it is on every Windows box,
//! it needs no dependency, and the answer is a yes/no that the UI turns into a warning.
//! The console window it would otherwise flash up is suppressed with `CREATE_NO_WINDOW`.

use serde::Serialize;
use std::collections::BTreeSet;

/// The sim itself. Holds textures open while it runs, so a copy can half-succeed.
pub const SIM_EXES: &[&str] = &["iRacingSim64DX11.exe", "iRacingSim64.exe"];
/// The launcher/UI. Does not lock textures, but tells you the sim is about to start.
pub const UI_EXES: &[&str] = &["iRacingUI.exe", "iRacingService.exe"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimState {
    /// The sim is on track or loading — the case where a copy can fail halfway.
    pub sim_running: bool,
    /// The launcher is open.
    pub ui_running: bool,
    pub matched: Vec<String>,
}

#[cfg(windows)]
fn running_image_names() -> BTreeSet<String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    // Keep the console window from flashing up on every check.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let output = Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    let Ok(output) = output else {
        return BTreeSet::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .filter_map(|line| {
            // CSV rows look like: "image.exe","1234","Console","1","12,345 K"
            let name = line.trim().strip_prefix('"')?;
            let end = name.find('"')?;
            Some(name[..end].to_ascii_lowercase())
        })
        .collect()
}

#[cfg(not(windows))]
fn running_image_names() -> BTreeSet<String> {
    BTreeSet::new()
}

/// Whether a named executable is running. Case-insensitive, exact image name.
pub fn is_running(exe: &str) -> bool {
    running_image_names().contains(&exe.to_ascii_lowercase())
}

/// One `tasklist` call answering every question the UI asks about iRacing.
pub fn sim_state() -> SimState {
    let names = running_image_names();
    let hit = |list: &[&str]| -> Vec<String> {
        list.iter()
            .filter(|e| names.contains(&e.to_ascii_lowercase()))
            .map(|e| e.to_string())
            .collect()
    };
    let sim = hit(SIM_EXES);
    let ui = hit(UI_EXES);
    let mut matched = sim.clone();
    matched.extend(ui.iter().cloned());
    SimState {
        sim_running: !sim.is_empty(),
        ui_running: !ui.is_empty(),
        matched,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_process_that_cannot_exist_is_not_running() {
        assert!(!is_running("doooom-no-such-process-42.exe"));
    }

    #[cfg(windows)]
    #[test]
    fn tasklist_parses_into_something() {
        // On Windows there is always at least one process; an empty set means the CSV
        // parsing broke, which would silently disable every guard in the app.
        assert!(!running_image_names().is_empty());
    }
}
