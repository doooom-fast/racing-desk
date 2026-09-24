//! What the app remembers between runs: the two folders and the customer id.
//!
//! Detection runs every launch regardless. These are overrides, so a user who has pointed
//! the app at an unusual install is not re-corrected on every start.

use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub paint_dir: Option<String>,
    pub library_root: Option<String>,
    pub customer_id: Option<String>,
    pub include_spec: Option<bool>,
    pub set_read_only_after: Option<bool>,
    pub clear_other_cooked: Option<bool>,
}

fn settings_path() -> Result<PathBuf> {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .ok_or_else(|| crate::error::AppError::other("No APPDATA to store settings in."))?;
    Ok(base.join("doooom-paints").join("settings.json"))
}

pub fn load() -> Settings {
    let Ok(path) = settings_path() else {
        return Settings::default();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        // A corrupt settings file should not stop the app starting; detection will refill it.
        .unwrap_or_default()
}

pub fn save(settings: &Settings) -> Result<()> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, serde_json::to_vec_pretty(settings)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_json() {
        let s = Settings {
            paint_dir: Some(r"C:\Users\x\Documents\iRacing\paint".into()),
            customer_id: Some("1159839".into()),
            include_spec: Some(true),
            ..Default::default()
        };
        let text = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&text).unwrap();
        assert_eq!(back.customer_id.as_deref(), Some("1159839"));
        assert_eq!(back.include_spec, Some(true));
        assert_eq!(back.library_root, None);
    }

    #[test]
    fn unknown_and_missing_fields_are_tolerated() {
        // An older or newer settings file must not stop the app starting.
        let back: Settings = serde_json::from_str(r#"{"customerId":"42","somethingNew":true}"#)
            .unwrap_or_default();
        assert_eq!(back.customer_id.as_deref(), Some("42"));
    }
}
