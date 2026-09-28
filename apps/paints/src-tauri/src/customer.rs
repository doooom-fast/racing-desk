//! Working out which customer id is *yours*.
//!
//! The plan proposes "most frequent `car_<digits>.tga` wins". On a clean install that is
//! right. On a real one it is not: Trading Paints fills the paint folder with every driver
//! you have shared a session with, so the paint folder here holds 3,200 car textures across
//! 85 cars and the most frequent id belongs to a stranger. The owner's own id appeared three
//! times and ranked eighteenth.
//!
//! So detection is a cascade, strongest signal first, and every step reports how much it
//! trusts itself. The user can always override.
//!
//!   1. **Trading Paints' own config** — it stores `User ID`. Authoritative.
//!   2. **A `car_spec_<id>.tga` on disk** — the downloader delivers other drivers' spec maps
//!      pre-cooked as `.mip`, so a spec map still in `.tga` form was almost certainly put
//!      there by hand. On this machine all three such files carry the owner's id.
//!   3. **Most frequent `car_<id>.tga`** — the plan's heuristic, kept as a last resort.

use crate::roles;
use crate::tradingpaints;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    /// Read from a config file that exists to record it.
    Certain,
    /// Inferred from a signal that is rarely wrong.
    Likely,
    /// A frequency count that can be swayed by other drivers' files.
    Guess,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdCandidate {
    pub id: String,
    /// `car_<id>.tga` files found.
    pub paints: usize,
    /// `car_spec_<id>.tga` files — the hand-installed marker.
    pub local_spec_maps: usize,
    /// How many car folders this id shows up in.
    pub car_folders: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerReport {
    pub id: Option<String>,
    pub confidence: Option<Confidence>,
    /// Where the answer came from, in words, for the UI to show under the field.
    pub source: Option<String>,
    /// Every id seen, best first, so the UI can offer a pick-list.
    pub candidates: Vec<IdCandidate>,
    pub notes: Vec<String>,
}

/// Tally every customer id that appears in the paint folder.
fn tally(paint_dir: &Path) -> Vec<IdCandidate> {
    #[derive(Default)]
    struct Counts {
        paints: usize,
        specs: usize,
        folders: usize,
    }
    let mut by_id: BTreeMap<String, Counts> = BTreeMap::new();

    let Ok(cars) = std::fs::read_dir(paint_dir) else {
        return Vec::new();
    };
    for car in cars.flatten() {
        if !car.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Ok(files) = std::fs::read_dir(car.path()) else {
            continue;
        };
        // An id counts once per car folder however many files it has there.
        let mut seen_here: BTreeMap<String, ()> = BTreeMap::new();
        for f in files.flatten() {
            let Some(name) = f.file_name().to_str().map(str::to_string) else {
                continue;
            };
            let Some((role, id, ext)) = roles::parse_installed(&name) else {
                continue;
            };
            if ext != roles::TEXTURE_EXT {
                continue; // .mip is the sim's cache, not evidence of a source file
            }
            let entry = by_id.entry(id.clone()).or_default();
            match role {
                "car" => entry.paints += 1,
                "car_spec" => entry.specs += 1,
                _ => {}
            }
            seen_here.insert(id, ());
        }
        for id in seen_here.into_keys() {
            by_id.entry(id).or_default().folders += 1;
        }
    }

    let mut out: Vec<IdCandidate> = by_id
        .into_iter()
        .map(|(id, c)| IdCandidate {
            id,
            paints: c.paints,
            local_spec_maps: c.specs,
            car_folders: c.folders,
        })
        .collect();
    // Hand-installed spec maps outrank raw frequency.
    out.sort_by(|a, b| {
        b.local_spec_maps
            .cmp(&a.local_spec_maps)
            .then(b.paints.cmp(&a.paints))
            .then(b.car_folders.cmp(&a.car_folders))
            .then(a.id.cmp(&b.id))
    });
    out
}

/// Run the cascade against a paint folder.
pub fn detect(paint_dir: &Path) -> CustomerReport {
    let candidates = tally(paint_dir);
    let mut notes = Vec::new();

    // 1. Trading Paints knows, because it has to.
    let tp = tradingpaints::inspect();
    if let Some(id) = tp.user_id.clone() {
        notes.push(format!(
            "Trading Paints is configured for customer {id}, which is where this came from."
        ));
        return CustomerReport {
            id: Some(id),
            confidence: Some(Confidence::Certain),
            source: Some("Trading Paints downloader config".to_string()),
            candidates,
            notes,
        };
    }

    // 2. A spec map still in .tga form was installed by hand.
    if let Some(best) = candidates.iter().find(|c| c.local_spec_maps > 0) {
        // Only trust it if nothing else also has hand-installed spec maps.
        let contenders = candidates.iter().filter(|c| c.local_spec_maps > 0).count();
        if contenders == 1 {
            notes.push(format!(
                "Customer {} is the only id with spec maps in .tga form. Trading Paints \
                 delivers other drivers' spec maps pre-cooked as .mip, so those were \
                 installed by hand.",
                best.id
            ));
            return CustomerReport {
                id: Some(best.id.clone()),
                confidence: Some(Confidence::Likely),
                source: Some("hand-installed spec maps".to_string()),
                candidates,
                notes,
            };
        }
        notes.push(format!(
            "{contenders} ids have hand-installed spec maps, so that signal did not settle it."
        ));
    }

    // 3. Frequency, with a health warning.
    match candidates.iter().max_by_key(|c| c.paints) {
        Some(best) => {
            notes.push(
                "This is the most common id in the paint folder, which is a weak signal: \
                 Trading Paints downloads other drivers' paints into the same folders. \
                 Check it before applying."
                    .to_string(),
            );
            CustomerReport {
                id: Some(best.id.clone()),
                confidence: Some(Confidence::Guess),
                source: Some("most frequent id in the paint folder".to_string()),
                candidates,
                notes,
            }
        }
        None => {
            notes.push("No car textures found, so there was nothing to infer an id from.".into());
            CustomerReport {
                id: None,
                confidence: None,
                source: None,
                candidates,
                notes,
            }
        }
    }
}

/// A customer id is digits and nothing else.
pub fn is_valid(id: &str) -> bool {
    !id.is_empty() && id.len() <= 12 && id.chars().all(|c| c.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &Path, name: &str) {
        std::fs::write(dir.join(name), b"x").unwrap();
    }

    fn fixture(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("doooom-customer-{tag}"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn spec_map_in_tga_beats_raw_frequency() {
        // The exact shape of the real machine: a stranger has more paints, the owner is the
        // only one with a .tga spec map.
        let root = fixture("spec");
        for car in ["lotus79", "mx5"] {
            let d = root.join(car);
            std::fs::create_dir_all(&d).unwrap();
            touch(&d, "car_999111.tga");
            touch(&d, "car_888222.tga");
        }
        let d = root.join("lotus79");
        touch(&d, "car_424242.tga");
        touch(&d, "car_spec_424242.tga");

        let ranked = tally(&root);
        assert_eq!(ranked[0].id, "424242");
        assert_eq!(ranked[0].local_spec_maps, 1);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn cooked_mip_files_are_not_evidence() {
        // A .mip is the sim's cache. Counting it would credit every downloaded paint.
        let root = fixture("mip");
        let d = root.join("lotus79");
        std::fs::create_dir_all(&d).unwrap();
        touch(&d, "car_spec_777.mip");
        touch(&d, "car_555.tga");

        let ranked = tally(&root);
        let seven = ranked.iter().find(|c| c.id == "777");
        assert!(seven.is_none() || seven.unwrap().local_spec_maps == 0);
        assert_eq!(ranked.iter().find(|c| c.id == "555").unwrap().paints, 1);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn counts_car_folders_once_per_id() {
        let root = fixture("folders");
        for car in ["a", "b"] {
            let d = root.join(car);
            std::fs::create_dir_all(&d).unwrap();
            touch(&d, "car_42.tga");
            touch(&d, "car_spec_42.tga");
        }
        let ranked = tally(&root);
        let c = ranked.iter().find(|c| c.id == "42").unwrap();
        assert_eq!(c.car_folders, 2);
        assert_eq!(c.paints, 2);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn helmets_and_suits_are_not_car_ids() {
        let root = fixture("helmets");
        let d = root.join("lotus79");
        std::fs::create_dir_all(&d).unwrap();
        touch(&d, "helmet_314159.tga");
        touch(&d, "suit_314159.tga");
        assert!(tally(&root).iter().all(|c| c.id != "314159"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn validates_ids() {
        assert!(is_valid("424242"));
        assert!(!is_valid(""));
        assert!(!is_valid("abc"));
        assert!(!is_valid("424 242"));
    }
}
