//! The library as a git checkout, so new liveries arrive by pulling rather than copying.
//!
//! The design pipeline commits finished paints to a repo; this app reads that repo's `cars/`
//! folder as its library. Keeping the two in step is then a `git pull`, and the app can say
//! whether one is due without the user going to look.
//!
//! Git is driven through the `git` command rather than a library crate. It is already on the
//! machine, and more importantly it already knows the user's credentials through their
//! credential helper — a linked-in implementation would have to ask for them again.
//!
//! Nothing here can lose work. The only write operation is `pull --ff-only`, which refuses to
//! merge or rebase, and it is refused outright if the working tree is dirty.

use crate::error::{AppError, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Long enough for a fetch of a repo full of multi-megabyte textures on a slow line, short
/// enough that a hung credential prompt does not wedge the UI for ever.
const NETWORK_TIMEOUT_SECS: u64 = 120;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub git_available: bool,
    /// The library folder is inside a git work tree.
    pub is_repo: bool,
    /// Top of the work tree, which is usually the library's parent.
    pub root: Option<String>,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub remote_url: Option<String>,
    pub head: Option<String>,
    pub subject: Option<String>,
    /// Uncommitted changes in the work tree. Blocks a pull.
    pub dirty: bool,
    /// Commits on the remote that are not here yet. Only as fresh as the last fetch, and
    /// left at zero when the remote has commits whose objects are not here to count.
    pub behind: usize,
    /// Commits here that are not on the remote.
    pub ahead: usize,
    /// The remote was asked directly — set by [`check`], not by a plain [`status`].
    pub checked_remote: bool,
    /// There is something on the remote that is not in this checkout. This is the honest
    /// answer even when `behind` cannot be counted.
    pub updates_available: bool,
    pub notes: Vec<String>,
}

/// Run git in `dir` and hand back trimmed stdout, or the error git printed.
fn git(dir: &Path, args: &[&str]) -> Result<String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(dir).args(args);
    // Never stop for a username prompt: this runs behind a UI with nowhere to type.
    cmd.env("GIT_TERMINAL_PROMPT", "0");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let out = cmd
        .output()
        .map_err(|e| AppError::other(format!("Could not run git: {e}")))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(AppError::other(if err.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            err
        }));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// The same, but `None` instead of an error — for the many queries that are simply absent on
/// a branch with no upstream or a repo with no commits.
fn git_opt(dir: &Path, args: &[&str]) -> Option<String> {
    git(dir, args).ok().filter(|s| !s.is_empty())
}

fn git_available() -> bool {
    let probe = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    git(&probe, &["--version"]).is_ok()
}

/// Read the repository around `path` without touching the network.
///
/// `behind` comes from the remote-tracking ref, so it is only as fresh as the last fetch.
/// [`fetch`] refreshes it.
pub fn status(path: &Path) -> RepoStatus {
    let mut st = RepoStatus {
        git_available: git_available(),
        ..Default::default()
    };
    if !st.git_available {
        st.notes
            .push("git is not on this machine, so the library cannot be updated from a repo.".into());
        return st;
    }
    if !path.is_dir() {
        return st;
    }

    let Some(root) = git_opt(path, &["rev-parse", "--show-toplevel"]) else {
        return st; // not a work tree, which is fine — a library need not be one
    };
    st.is_repo = true;
    st.root = Some(root.clone());
    let root = PathBuf::from(&root);

    st.branch = git_opt(&root, &["rev-parse", "--abbrev-ref", "HEAD"]);
    st.head = git_opt(&root, &["rev-parse", "--short", "HEAD"]);
    st.subject = git_opt(&root, &["log", "-1", "--pretty=%s"]);
    st.dirty = git_opt(&root, &["status", "--porcelain"]).is_some();

    st.upstream = git_opt(&root, &["rev-parse", "--abbrev-ref", "@{upstream}"]);
    if let Some(upstream) = &st.upstream {
        if let Some(remote) = upstream.split('/').next() {
            st.remote_url = git_opt(&root, &["remote", "get-url", remote]);
        }
        // left = commits only here, right = commits only upstream.
        if let Some(counts) = git_opt(&root, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
        {
            let mut parts = counts.split_whitespace();
            st.ahead = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            st.behind = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        }
    } else {
        st.notes
            .push("This branch is not tracking a remote, so there is nothing to update from.".into());
    }

    st.updates_available = st.behind > 0;

    if st.dirty {
        st.notes.push(
            "The repository has uncommitted changes. Updating is held back so they are not \
             disturbed."
                .into(),
        );
    }
    st
}

/// Ask the remote for one branch tip. A few hundred bytes over the wire — it transfers no
/// objects, which is what makes it safe to run on every launch.
fn remote_tip(root: &Path, upstream: &str) -> Option<String> {
    let (remote, branch) = upstream.split_once('/')?;
    let refname = format!("refs/heads/{branch}");
    let out = git(root, &["ls-remote", "--quiet", remote, &refname]).ok()?;
    out.split_whitespace().next().map(str::to_string)
}

fn has_object(root: &Path, sha: &str) -> bool {
    git(root, &["cat-file", "-e", &format!("{sha}^{{commit}}")]).is_ok()
}

/// Is `sha` already contained in HEAD?
fn is_ancestor(root: &Path, sha: &str) -> bool {
    git(root, &["merge-base", "--is-ancestor", sha, "HEAD"]).is_ok()
}

/// Ask the remote whether anything is waiting, without downloading it.
///
/// [`fetch`] would answer the same question but pulls down every new object to do it — on a
/// repo of multi-megabyte textures that is tens of megabytes, silently, every launch. This
/// costs one small request, and only [`pull`] transfers anything.
pub fn check(path: &Path) -> Result<RepoStatus> {
    let mut st = status(path);
    if !st.is_repo {
        return Err(AppError::refused("The library is not inside a git repository."));
    }
    let Some(upstream) = st.upstream.clone() else {
        return Ok(st); // nothing to check against; status already says so
    };
    let root = PathBuf::from(st.root.as_deref().unwrap_or_default());

    let Some(tip) = remote_tip(&root, &upstream) else {
        st.notes
            .push("Could not reach the remote to check for updates.".into());
        return Ok(st);
    };
    st.checked_remote = true;

    let head = git_opt(&root, &["rev-parse", "HEAD"]);
    if head.as_deref() == Some(tip.as_str()) {
        st.behind = 0;
        st.updates_available = false;
        return Ok(st);
    }

    if has_object(&root, &tip) {
        // The objects are already here, so the count is exact.
        st.updates_available = !is_ancestor(&root, &tip);
        st.behind = git_opt(&root, &["rev-list", "--count", &format!("HEAD..{tip}")])
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
    } else {
        // Something new is up there. Counting it would mean downloading it.
        st.updates_available = true;
    }
    Ok(st)
}

/// Ask the remote what it has. Read-only: it moves remote-tracking refs, never the work tree.
pub fn fetch(path: &Path) -> Result<RepoStatus> {
    let st = status(path);
    if !st.is_repo {
        return Err(AppError::refused("The library is not inside a git repository."));
    }
    let root = PathBuf::from(st.root.as_deref().unwrap_or_default());

    git(
        &root,
        &[
            "-c",
            &format!("http.lowSpeedTime={NETWORK_TIMEOUT_SECS}"),
            "fetch",
            "--quiet",
            "--prune",
        ],
    )?;
    Ok(status(path))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullReport {
    pub updated: bool,
    /// One line per commit that arrived.
    pub commits: Vec<String>,
    pub status: RepoStatus,
}

/// Fast-forward the library to the remote.
///
/// `--ff-only` is the whole safety story: if the branches have diverged git stops rather than
/// inventing a merge, and a dirty tree is refused before git is asked at all.
pub fn pull(path: &Path) -> Result<PullReport> {
    let before = fetch(path)?;
    if !before.is_repo {
        return Err(AppError::refused("The library is not inside a git repository."));
    }
    if before.upstream.is_none() {
        return Err(AppError::refused(
            "This branch is not tracking a remote, so there is nothing to pull.",
        ));
    }
    if before.dirty {
        return Err(AppError::refused(
            "The repository has uncommitted changes. Commit or stash them first — pulling over \
             them could lose work.",
        ));
    }
    let root = PathBuf::from(before.root.as_deref().unwrap_or_default());

    if before.behind == 0 {
        return Ok(PullReport {
            updated: false,
            commits: Vec::new(),
            status: before,
        });
    }

    // Capture what is about to arrive, while it is still only on the remote side.
    let commits = git_opt(
        &root,
        &["log", "--pretty=%h %s", "--no-merges", "HEAD..@{upstream}"],
    )
    .map(|s| s.lines().map(str::to_string).collect())
    .unwrap_or_default();

    git(&root, &["pull", "--ff-only", "--quiet"]).map_err(|e| {
        AppError::refused(format!(
            "Could not fast-forward the library: {e} Nothing was changed."
        ))
    })?;

    Ok(PullReport {
        updated: true,
        commits,
        status: status(path),
    })
}

/// Does this folder look like a library — car folders holding version folders holding textures?
///
/// The nesting is what makes this safe to run over the sim's own paint directory: a car folder
/// there has textures directly inside it, not a layer of version folders, so it cannot be
/// mistaken for a library root.
pub fn looks_like_library(path: &Path) -> bool {
    let Ok(cars) = std::fs::read_dir(path) else {
        return false;
    };
    for car in cars.flatten().take(200) {
        if !car.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Ok(versions) = std::fs::read_dir(car.path()) else {
            continue;
        };
        for version in versions.flatten().take(200) {
            if !version.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let Ok(files) = std::fs::read_dir(version.path()) else {
                continue;
            };
            for f in files.flatten() {
                if let Some(name) = f.file_name().to_str() {
                    if crate::roles::parse_library_file(name).is_some() {
                        return true;
                    }
                }
            }
        }
    }
    false
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySuggestion {
    pub path: String,
    pub cars: usize,
    pub repo: RepoStatus,
}

/// Look for a library near the sim, so the common case needs no browsing.
///
/// A checkout of the liveries repo sitting in or beside the paint folder is the shape the
/// design pipeline already produces, and `cars/` inside it is the library.
pub fn suggest_libraries(paint_dir: &Path) -> Vec<LibrarySuggestion> {
    let mut roots: Vec<PathBuf> = Vec::new();

    let mut consider = |dir: PathBuf| {
        if !dir.is_dir() {
            return;
        }
        for candidate in [dir.join("cars"), dir] {
            if candidate.is_dir() && !roots.contains(&candidate) {
                roots.push(candidate);
            }
        }
    };

    // A checkout dropped inside the paint folder, and one sitting alongside it.
    for base in [Some(paint_dir.to_path_buf()), paint_dir.parent().map(Path::to_path_buf)]
        .into_iter()
        .flatten()
    {
        if let Ok(entries) = std::fs::read_dir(&base) {
            for e in entries.flatten().take(400) {
                if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    consider(e.path());
                }
            }
        }
    }
    // The usual home for checkouts on this kind of machine.
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        let github = PathBuf::from(profile).join("Documents").join("GitHub");
        if let Ok(entries) = std::fs::read_dir(&github) {
            for e in entries.flatten().take(200) {
                if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    consider(e.path());
                }
            }
        }
    }

    let mut out: Vec<LibrarySuggestion> = roots
        .into_iter()
        .filter(|p| looks_like_library(p))
        .map(|p| {
            let cars = std::fs::read_dir(&p)
                .map(|d| {
                    d.flatten()
                        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                        .count()
                })
                .unwrap_or(0);
            LibrarySuggestion {
                repo: status(&p),
                path: p.to_string_lossy().to_string(),
                cars,
            }
        })
        .collect();

    // A checkout that can be kept up to date is more useful than a loose folder.
    out.sort_by(|a, b| {
        b.repo
            .is_repo
            .cmp(&a.repo.is_repo)
            .then(b.cars.cmp(&a.cars))
            .then(a.path.cmp(&b.path))
    });
    out.truncate(6);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("doooom-repo-{tag}"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn make_library(root: &Path) {
        let v = root.join("lotus79").join("v13");
        std::fs::create_dir_all(&v).unwrap();
        std::fs::write(v.join("car_1159839.tga"), b"paint").unwrap();
    }

    #[test]
    fn recognises_the_library_nesting() {
        let root = fixture("lib");
        make_library(&root);
        assert!(looks_like_library(&root));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_sim_paint_folder_is_not_a_library() {
        // The sim's car folders hold textures directly, with no version layer. Without the
        // nesting check, suggestions would offer the paint folder as its own library.
        let root = fixture("simpaint");
        let car = root.join("lotus79");
        std::fs::create_dir_all(&car).unwrap();
        std::fs::write(car.join("car_1159839.tga"), b"paint").unwrap();
        std::fs::write(car.join("car_spec_1159839.mip"), b"cooked").unwrap();
        assert!(!looks_like_library(&root));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn an_empty_or_missing_folder_is_not_a_library() {
        let root = fixture("empty");
        assert!(!looks_like_library(&root));
        assert!(!looks_like_library(&root.join("nope")));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_folder_outside_a_repo_reports_no_repo() {
        let root = fixture("norepo");
        make_library(&root);
        let st = status(&root);
        // git itself should be present wherever these tests run.
        assert!(st.git_available);
        assert!(!st.is_repo);
        assert_eq!(st.behind, 0);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn reads_a_real_checkout_and_refuses_to_pull_a_dirty_one() {
        let root = fixture("realrepo");
        // A repo with no upstream: enough to exercise everything but the network.
        git(&root, &["init", "--quiet"]).unwrap();
        git(&root, &["config", "user.email", "t@example.com"]).unwrap();
        git(&root, &["config", "user.name", "Test"]).unwrap();
        make_library(&root);
        git(&root, &["add", "-A"]).unwrap();
        git(&root, &["commit", "--quiet", "-m", "first livery"]).unwrap();

        let st = status(&root);
        assert!(st.is_repo);
        assert!(!st.dirty);
        assert_eq!(st.subject.as_deref(), Some("first livery"));
        assert!(st.head.is_some());
        // No upstream, so pulling has nothing to do and says so rather than failing oddly.
        assert!(st.upstream.is_none());
        assert!(pull(&root).is_err());

        // Dirty it, and the refusal must mention the work rather than git internals.
        std::fs::write(root.join("lotus79").join("v13").join("car_1159839.tga"), b"edited")
            .unwrap();
        let dirty = status(&root);
        assert!(dirty.dirty);
        assert!(dirty.notes.iter().any(|n| n.contains("uncommitted")));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn counts_how_far_behind_a_checkout_is() {
        // Clone a local repo, move the origin on, and check the count without a network.
        let origin = fixture("origin");
        git(&origin, &["init", "--quiet", "--bare"]).unwrap();

        let work = fixture("work");
        git(&work, &["clone", "--quiet", &origin.to_string_lossy(), "."]).unwrap();
        git(&work, &["config", "user.email", "t@example.com"]).unwrap();
        git(&work, &["config", "user.name", "Test"]).unwrap();
        make_library(&work);
        git(&work, &["add", "-A"]).unwrap();
        git(&work, &["commit", "--quiet", "-m", "first livery"]).unwrap();
        git(&work, &["push", "--quiet", "-u", "origin", "HEAD"]).unwrap();

        let clone = fixture("clone");
        git(&clone, &["clone", "--quiet", &origin.to_string_lossy(), "."]).unwrap();
        // A local clone would otherwise share the origin's object store, which would hide
        // whether a check downloads anything.
        git(&clone, &["repack", "-a", "-d", "--quiet"]).ok();
        assert_eq!(status(&clone).behind, 0);
        assert!(!check(&clone).unwrap().updates_available);

        // A new livery lands upstream.
        let v = work.join("nissangtpzxt").join("v10");
        std::fs::create_dir_all(&v).unwrap();
        std::fs::write(v.join("car_1159839.tga"), b"paint").unwrap();
        git(&work, &["add", "-A"]).unwrap();
        git(&work, &["commit", "--quiet", "-m", "add the Nissan"]).unwrap();
        git(&work, &["push", "--quiet"]).unwrap();

        // The cheap check must spot it while transferring nothing. Proof that nothing was
        // downloaded: the commit's object is still not here afterwards.
        let checked = check(&clone).unwrap();
        assert!(checked.checked_remote);
        assert!(checked.updates_available, "check should see the new commit");
        let tip = remote_tip(&clone, checked.upstream.as_deref().unwrap()).unwrap();
        assert!(
            !has_object(&clone, &tip),
            "check downloaded objects; it is meant to ask, not fetch"
        );

        let fetched = fetch(&clone).unwrap();
        assert_eq!(fetched.behind, 1, "should see the new commit after fetching");
        assert_eq!(fetched.ahead, 0);

        // Once the objects are here the count is exact.
        let counted = check(&clone).unwrap();
        assert_eq!(counted.behind, 1);
        assert!(counted.updates_available);

        let report = pull(&clone).unwrap();
        assert!(report.updated);
        assert_eq!(report.commits.len(), 1);
        assert!(report.commits[0].contains("add the Nissan"));
        assert_eq!(report.status.behind, 0);
        assert!(clone.join("nissangtpzxt").join("v10").is_dir());

        // Pulling again is a no-op, not an error.
        let again = pull(&clone).unwrap();
        assert!(!again.updated);
        assert!(again.commits.is_empty());

        for d in [origin, work, clone] {
            std::fs::remove_dir_all(&d).ok();
        }
    }
}
