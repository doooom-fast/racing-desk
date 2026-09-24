//! Trading Paints: what it is about to do to your paint folder.
//!
//! The plan asks for a guard that says whether `TradingPaintsDownloader.exe` is running.
//! That is the weaker half of the problem. The downloader keeps its settings in
//! `%APPDATA%\TradingPaints Downloader\config.xml`, and two of them decide whether your own
//! work survives:
//!
//!   * **Download my schemes** — the "Update My Own Paints" switch. On, and the downloader
//!     pulls your paints from the website over the top of the local files you just applied.
//!   * **Delete schemes before downloading** — on, and it clears paints out first.
//!
//! Reading those is the difference between "the downloader is running" and "the downloader
//! is running and it is configured to overwrite exactly the car you are working on".
//!
//! The same file carries **User ID**, which is the customer id straight from the horse's
//! mouth — far better than inferring it from filenames.

use crate::process;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::PathBuf;

pub const DOWNLOADER_EXE: &str = "TradingPaintsDownloader.exe";

/// Setting names as the downloader spells them in its config file.
const KEY_USER_ID: &str = "User ID";
const KEY_DOWNLOAD_MINE: &str = "Download my schemes";
const KEY_DELETE_BEFORE: &str = "Delete schemes before downloading";
const KEY_DELETE_AFTER: &str = "Delete schemes once session ends";
const KEY_KEEP_SYNCED: &str = "Keep my paints synced from website";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradingPaints {
    /// Whether `config.xml` was found and parsed.
    pub config_found: bool,
    pub config_path: Option<String>,
    pub running: bool,
    pub user_id: Option<String>,
    /// "Update My Own Paints" — the one that overwrites your car.
    pub download_my_schemes: Option<bool>,
    pub delete_before_downloading: Option<bool>,
    pub delete_after_session: Option<bool>,
    pub keep_synced: Option<bool>,
    /// Plain-language warnings, worst first. Empty means nothing to say.
    pub warnings: Vec<String>,
}

impl TradingPaints {
    /// True when something about the current setup can undo an apply.
    pub fn is_risky(&self) -> bool {
        !self.warnings.is_empty()
    }
}

fn config_path() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    Some(
        PathBuf::from(appdata)
            .join("TradingPaints Downloader")
            .join("config.xml"),
    )
}

/// Pull `<configname>`/`<configvalue>` pairs out of the downloader's config.
///
/// The file is small, flat and machine-written, so a scan beats a dependency. Anything
/// that does not match the expected shape is skipped rather than guessed at.
fn parse_config(xml: &str) -> BTreeMap<String, String> {
    // The downloader writes a UTF-8 BOM; left in place it becomes part of the first tag.
    let xml = xml.trim_start_matches('\u{feff}');
    let mut out = BTreeMap::new();
    let mut rest = xml;
    while let Some(name) = take_tag(&mut rest, "configname") {
        match take_tag(&mut rest, "configvalue") {
            Some(value) => {
                out.insert(name.trim().to_string(), value.trim().to_string());
            }
            // A name with no value following it means the file is truncated; stop rather
            // than pairing this name with some later option's value.
            None => break,
        }
    }
    out
}

/// Consume up to and including the next `<tag>…</tag>`, returning its contents.
fn take_tag(rest: &mut &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = rest.find(&open)? + open.len();
    let end_rel = rest[start..].find(&close)?;
    let value = rest[start..start + end_rel].to_string();
    *rest = &rest[start + end_rel + close.len()..];
    Some(value)
}

fn as_bool(map: &BTreeMap<String, String>, key: &str) -> Option<bool> {
    map.get(key).and_then(|v| match v.trim().to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" => Some(true),
        "false" | "0" | "no" => Some(false),
        _ => None,
    })
}

/// Read the downloader's settings and check whether it is running.
pub fn inspect() -> TradingPaints {
    let path = config_path();
    let text = path.as_ref().and_then(|p| std::fs::read_to_string(p).ok());
    let map = text.as_deref().map(parse_config).unwrap_or_default();

    let user_id = map.get(KEY_USER_ID).and_then(|v| {
        let v = v.trim();
        (!v.is_empty() && v.chars().all(|c| c.is_ascii_digit())).then(|| v.to_string())
    });

    let download_my_schemes = as_bool(&map, KEY_DOWNLOAD_MINE);
    let delete_before_downloading = as_bool(&map, KEY_DELETE_BEFORE);
    let delete_after_session = as_bool(&map, KEY_DELETE_AFTER);
    let keep_synced = as_bool(&map, KEY_KEEP_SYNCED);
    let running = process::is_running(DOWNLOADER_EXE);

    let mut warnings = Vec::new();
    if download_my_schemes == Some(true) {
        warnings.push(
            "Trading Paints has \"Download my schemes\" switched on. It will pull your paints \
             from the website over the top of whatever this app installs."
                .to_string(),
        );
    }
    if keep_synced == Some(true) {
        warnings.push(
            "Trading Paints is set to keep your paints synced from the website, which can \
             replace a local paint after it is applied."
                .to_string(),
        );
    }
    if delete_before_downloading == Some(true) && running {
        warnings.push(
            "Trading Paints deletes paints before downloading, and the downloader is running \
             now. Applied files can disappear when the next session starts."
                .to_string(),
        );
    }
    if delete_after_session == Some(true) {
        warnings.push(
            "Trading Paints deletes downloaded paints when a session ends. Your own applied \
             files are named the same way and can be caught by this."
                .to_string(),
        );
    }
    if running && warnings.is_empty() {
        warnings.push(
            "The Trading Paints downloader is running. Its settings look safe, but it has the \
             paint folder open."
                .to_string(),
        );
    }

    TradingPaints {
        config_found: !map.is_empty(),
        config_path: path.map(|p| p.to_string_lossy().to_string()),
        running,
        user_id,
        download_my_schemes,
        delete_before_downloading,
        delete_after_session,
        keep_synced,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Trimmed from a real config.xml, BOM and all.
    const SAMPLE: &str = "\u{feff}<?xml version=\"1.0\" encoding=\"utf-8\"?>
<!--This is the main configuration of the downloader-->
<Settings>
  <Option>
    <configname>Delete schemes once session ends</configname>
    <configvalue>False</configvalue>
  </Option>
  <Option>
    <configname>Download my schemes</configname>
    <configvalue>False</configvalue>
  </Option>
  <Option>
    <configname>Delete schemes before downloading</configname>
    <configvalue>True</configvalue>
  </Option>
  <Option>
    <configname>User ID</configname>
    <configvalue>1159839</configvalue>
  </Option>
</Settings>";

    #[test]
    fn reads_real_config_shape() {
        let map = parse_config(SAMPLE);
        assert_eq!(map.get("User ID").map(String::as_str), Some("1159839"));
        assert_eq!(as_bool(&map, KEY_DOWNLOAD_MINE), Some(false));
        assert_eq!(as_bool(&map, KEY_DELETE_BEFORE), Some(true));
    }

    #[test]
    fn bom_does_not_break_the_first_tag() {
        // Left in, the BOM rides along on the opening tag and the whole file reads empty.
        assert!(!parse_config(SAMPLE).is_empty());
    }

    #[test]
    fn truncated_file_does_not_pair_across_options() {
        let xml = "<configname>A</configname><configvalue>1</configvalue><configname>B</configname>";
        let map = parse_config(xml);
        assert_eq!(map.get("A").map(String::as_str), Some("1"));
        assert!(!map.contains_key("B"));
    }

    #[test]
    fn unknown_booleans_stay_unknown() {
        let mut m = BTreeMap::new();
        m.insert("k".to_string(), "maybe".to_string());
        assert_eq!(as_bool(&m, "k"), None);
    }

    #[test]
    fn non_numeric_user_id_is_rejected() {
        let map = parse_config("<configname>User ID</configname><configvalue>abc</configvalue>");
        let id = map.get(KEY_USER_ID).and_then(|v| {
            let v = v.trim();
            (!v.is_empty() && v.chars().all(|c| c.is_ascii_digit())).then(|| v.to_string())
        });
        assert_eq!(id, None);
    }
}
