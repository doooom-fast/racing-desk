//! What is in the sim's folder for one car right now, and which library version it is.
//!
//! "Which version is applied" is answered by hashing, not by remembering what the app last
//! did: a file can change under the app at any time — Trading Paints, a manual copy, the
//! design pipeline writing straight into the sim — and a remembered answer would be a lie.

use crate::digest;
use crate::error::Result;
use crate::library::Version;
use crate::roles;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledFile {
    pub role: String,
    pub role_label: String,
    pub file_name: String,
    pub path: String,
    pub size: u64,
    pub sha256: String,
    pub read_only: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MatchKind {
    /// Every texture in the version is installed, byte for byte.
    Exact,
    /// The paint matches but the spec map does not — the classic half-applied state.
    PaintOnly,
    None,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledState {
    pub sim_folder: Option<String>,
    pub folder_exists: bool,
    pub files: Vec<InstalledFile>,
    /// `.mip` files the sim cooked for this customer id — the ones an apply must clear.
    pub cooked: Vec<String>,
    /// Cooked files belonging to other drivers. Never touched; counted so the UI can
    /// explain why it is not deleting them.
    pub cooked_other_drivers: usize,
    pub applied_version_id: Option<String>,
    pub match_kind: MatchKind,
    pub any_read_only: bool,
}

/// Read every `car*_<id>.*` file in the sim's folder for one car.
pub fn read(paint_dir: &Path, sim_folder: Option<&str>, customer_id: &str) -> Result<InstalledState> {
    let Some(sim_folder) = sim_folder else {
        return Ok(InstalledState {
            sim_folder: None,
            folder_exists: false,
            files: Vec::new(),
            cooked: Vec::new(),
            cooked_other_drivers: 0,
            applied_version_id: None,
            match_kind: MatchKind::None,
            any_read_only: false,
        });
    };
    let dir = paint_dir.join(sim_folder);
    if !dir.is_dir() {
        return Ok(InstalledState {
            sim_folder: Some(sim_folder.to_string()),
            folder_exists: false,
            files: Vec::new(),
            cooked: Vec::new(),
            cooked_other_drivers: 0,
            applied_version_id: None,
            match_kind: MatchKind::None,
            any_read_only: false,
        });
    }

    let mut files = Vec::new();
    let mut cooked = Vec::new();
    let mut cooked_other_drivers = 0usize;

    for entry in std::fs::read_dir(&dir)?.flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some((role, id, ext)) = roles::parse_installed(&name) else {
            continue;
        };
        let path = entry.path();

        if ext == roles::COOKED_EXT {
            if id == customer_id {
                cooked.push(path.to_string_lossy().to_string());
            } else {
                cooked_other_drivers += 1;
            }
            continue;
        }
        if id != customer_id {
            continue;
        }

        let md = std::fs::metadata(&path)?;
        files.push(InstalledFile {
            role: role.to_string(),
            role_label: roles::role_label(role).to_string(),
            file_name: name,
            path: path.to_string_lossy().to_string(),
            size: md.len(),
            sha256: digest::file_sha256(&path)?,
            read_only: md.permissions().readonly(),
        });
    }

    files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    cooked.sort();
    let any_read_only = files.iter().any(|f| f.read_only);

    Ok(InstalledState {
        sim_folder: Some(sim_folder.to_string()),
        folder_exists: true,
        files,
        cooked,
        cooked_other_drivers,
        applied_version_id: None,
        match_kind: MatchKind::None,
        any_read_only,
    })
}

fn hash_of<'a>(files: &'a [InstalledFile], role: &str) -> Option<&'a str> {
    files
        .iter()
        .find(|f| f.role == role)
        .map(|f| f.sha256.as_str())
}

/// Compare what is installed against each version and mark the one that is live.
///
/// Exact beats paint-only, and the first exact match wins. Two versions with identical
/// bytes are genuinely indistinguishable on disk, so picking either is honest.
pub fn identify(state: &mut InstalledState, versions: &[Version]) {
    let mut best: Option<(&Version, MatchKind)> = None;

    for version in versions {
        if version.files.is_empty() {
            continue;
        }
        let all_match = version.files.iter().all(|vf| {
            hash_of(&state.files, &vf.role).map(|h| h == vf.sha256).unwrap_or(false)
        });
        // Extra car textures installed that this version does not carry mean the folder
        // holds something this version did not put there.
        let no_extras = state
            .files
            .iter()
            .all(|inst| version.files.iter().any(|vf| vf.role == inst.role));

        let kind = if all_match && no_extras {
            MatchKind::Exact
        } else {
            let paint_matches = version
                .files
                .iter()
                .find(|vf| vf.role == "car")
                .and_then(|vf| hash_of(&state.files, "car").map(|h| h == vf.sha256))
                .unwrap_or(false);
            if paint_matches {
                MatchKind::PaintOnly
            } else {
                MatchKind::None
            }
        };

        match kind {
            MatchKind::Exact => {
                best = Some((version, MatchKind::Exact));
                break;
            }
            MatchKind::PaintOnly if best.is_none() => {
                best = Some((version, MatchKind::PaintOnly));
            }
            _ => {}
        }
    }

    match best {
        Some((v, kind)) => {
            state.applied_version_id = Some(v.id.clone());
            state.match_kind = kind;
        }
        None => {
            state.applied_version_id = None;
            state.match_kind = MatchKind::None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::{Meta, VersionFile};

    fn inst(role: &str, sha: &str) -> InstalledFile {
        InstalledFile {
            role: role.into(),
            role_label: roles::role_label(role).into(),
            file_name: format!("{role}_1159839.tga"),
            path: String::new(),
            size: 1,
            sha256: sha.into(),
            read_only: false,
        }
    }

    fn vfile(role: &str, sha: &str) -> VersionFile {
        VersionFile {
            role: role.into(),
            role_label: roles::role_label(role).into(),
            file_name: format!("{role}.tga"),
            path: String::new(),
            size: 1,
            sha256: sha.into(),
        }
    }

    fn version(id: &str, files: Vec<VersionFile>) -> Version {
        Version {
            id: id.into(),
            name: id.into(),
            path: String::new(),
            has_paint: files.iter().any(|f| f.role == "car"),
            has_spec: files.iter().any(|f| f.role == "car_spec"),
            files,
            previews: vec![],
            meta: Meta::default(),
            problems: vec![],
        }
    }

    fn state(files: Vec<InstalledFile>) -> InstalledState {
        InstalledState {
            sim_folder: Some("lotus79".into()),
            folder_exists: true,
            files,
            cooked: vec![],
            cooked_other_drivers: 0,
            applied_version_id: None,
            match_kind: MatchKind::None,
            any_read_only: false,
        }
    }

    #[test]
    fn exact_match_is_found() {
        let mut s = state(vec![inst("car", "aa"), inst("car_spec", "bb")]);
        let versions = vec![version("v13", vec![vfile("car", "aa"), vfile("car_spec", "bb")])];
        identify(&mut s, &versions);
        assert_eq!(s.applied_version_id.as_deref(), Some("v13"));
        assert_eq!(s.match_kind, MatchKind::Exact);
    }

    #[test]
    fn paint_without_its_spec_is_half_applied() {
        // The state you land in when the spec map silently failed to copy.
        let mut s = state(vec![inst("car", "aa"), inst("car_spec", "WRONG")]);
        let versions = vec![version("v13", vec![vfile("car", "aa"), vfile("car_spec", "bb")])];
        identify(&mut s, &versions);
        assert_eq!(s.applied_version_id.as_deref(), Some("v13"));
        assert_eq!(s.match_kind, MatchKind::PaintOnly);
    }

    #[test]
    fn exact_wins_over_an_earlier_partial() {
        let mut s = state(vec![inst("car", "aa"), inst("car_spec", "bb")]);
        let versions = vec![
            version("partial", vec![vfile("car", "aa"), vfile("car_spec", "zz")]),
            version("exact", vec![vfile("car", "aa"), vfile("car_spec", "bb")]),
        ];
        identify(&mut s, &versions);
        assert_eq!(s.applied_version_id.as_deref(), Some("exact"));
        assert_eq!(s.match_kind, MatchKind::Exact);
    }

    #[test]
    fn a_leftover_texture_stops_it_being_exact() {
        // A decal from a previous paint is still on disk; the folder is not purely this
        // version, and claiming otherwise would hide the leftover.
        let mut s = state(vec![
            inst("car", "aa"),
            inst("car_spec", "bb"),
            inst("car_decal", "cc"),
        ]);
        let versions = vec![version("v13", vec![vfile("car", "aa"), vfile("car_spec", "bb")])];
        identify(&mut s, &versions);
        assert_eq!(s.match_kind, MatchKind::PaintOnly);
    }

    #[test]
    fn nothing_installed_matches_nothing() {
        let mut s = state(vec![]);
        let versions = vec![version("v13", vec![vfile("car", "aa")])];
        identify(&mut s, &versions);
        assert_eq!(s.applied_version_id, None);
        assert_eq!(s.match_kind, MatchKind::None);
    }
}
