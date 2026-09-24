//! Content hashing, used to answer "is this version the one currently installed?".
//!
//! Paint files are multi-megabyte TGAs and a car can have several versions, so hashes are
//! cached against the file's size and modification time. Nothing here is security-sensitive;
//! the hash only has to tell two paints apart.

use crate::error::Result;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::sync::Mutex;
use std::time::SystemTime;

#[derive(Clone, PartialEq, Eq)]
struct Stamp {
    len: u64,
    modified: Option<SystemTime>,
}

static CACHE: Mutex<Option<HashMap<String, (Stamp, String)>>> = Mutex::new(None);

fn stamp(path: &Path) -> Result<Stamp> {
    let md = std::fs::metadata(path)?;
    Ok(Stamp {
        len: md.len(),
        modified: md.modified().ok(),
    })
}

/// SHA-256 of a file, hex encoded, memoised on (path, size, mtime).
pub fn file_sha256(path: &Path) -> Result<String> {
    let key = path.to_string_lossy().to_ascii_lowercase();
    let current = stamp(path)?;

    if let Ok(mut guard) = CACHE.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        if let Some((cached, hex)) = map.get(&key) {
            if *cached == current {
                return Ok(hex.clone());
            }
        }
    }

    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let hex = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();

    if let Ok(mut guard) = CACHE.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        map.insert(key, (current, hex.clone()));
    }
    Ok(hex)
}

/// Drop everything memoised. Called after an apply or revert, when files on disk moved
/// under us and a stale "currently applied" badge would be actively misleading.
pub fn clear_cache() {
    if let Ok(mut guard) = CACHE.lock() {
        *guard = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_and_notices_changes() {
        let dir = std::env::temp_dir().join("doooom-digest-test");
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.bin");

        std::fs::write(&p, b"hello").unwrap();
        let first = file_sha256(&p).unwrap();
        // Known value, so a broken hasher cannot quietly agree with itself.
        assert_eq!(
            first,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );

        // A rewrite of a different length must invalidate the cache even if the clock is
        // too coarse to notice the mtime change.
        std::fs::write(&p, b"hello world").unwrap();
        assert_ne!(file_sha256(&p).unwrap(), first);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_file_is_an_error_not_a_hash() {
        assert!(file_sha256(Path::new("no-such-file-doooom.tga")).is_err());
    }
}
