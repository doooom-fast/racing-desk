//! Smoke tests against whatever iRacing install is on this machine.
//!
//! Every path, lock and process check in this app is Windows behaviour, and the unit tests
//! run on fixtures that are necessarily tidier than a real paint folder — a real one holds
//! thousands of other drivers' files downloaded by Trading Paints, which is exactly the
//! condition that breaks naive detection.
//!
//! These are `#[ignore]` because they describe the machine rather than the code, and there
//! is no install on a build server. Run them on the gaming PC:
//!
//! ```text
//! cargo test --test real_machine -- --ignored --nocapture
//! ```

use doooom_paints_lib::{customer, library, paths, process, tradingpaints};

#[test]
#[ignore = "reads the real iRacing install"]
fn reports_the_paint_folders_it_can_see() {
    let report = paths::detect();
    println!("\n-- paint folder candidates --");
    for c in &report.candidates {
        println!(
            "  {:<5} {:<28} {:>3} cars  {}{}",
            if c.exists { "[on]" } else { "[--]" },
            c.source,
            c.car_folders,
            c.path,
            if c.is_one_drive { "  (OneDrive)" } else { "" },
        );
    }
    println!("  chosen:    {:?}", report.chosen);
    println!("  ambiguous: {}", report.ambiguous);
    for n in &report.notes {
        println!("  note: {n}");
    }

    // Whatever it picks must be a folder that is actually there.
    if let Some(chosen) = &report.chosen {
        assert!(
            std::path::Path::new(chosen).is_dir(),
            "chose a path that is not a directory"
        );
    }
}

#[test]
#[ignore = "reads the real iRacing install"]
fn detects_a_customer_id_and_says_how_sure_it_is() {
    let Some(paint) = paths::detect().chosen else {
        println!("no paint folder on this machine; nothing to detect");
        return;
    };
    let report = customer::detect(std::path::Path::new(&paint));

    println!("\n-- customer id --");
    println!("  id:         {:?}", report.id);
    println!("  confidence: {:?}", report.confidence);
    println!("  source:     {:?}", report.source);
    for n in &report.notes {
        println!("  note: {n}");
    }
    println!("  top candidates by the plan's own heuristic (most paints wins):");
    let mut by_paints = report.candidates.clone();
    by_paints.sort_by(|a, b| b.paints.cmp(&a.paints));
    for c in by_paints.iter().take(5) {
        println!(
            "    {:<10} {:>4} paints  {:>3} local spec maps  {:>3} car folders",
            c.id, c.paints, c.local_spec_maps, c.car_folders
        );
    }

    if let Some(id) = &report.id {
        assert!(customer::is_valid(id), "detected id is not digits: {id}");
    }
}

#[test]
#[ignore = "reads the real iRacing install"]
fn frequency_alone_would_pick_the_wrong_id() {
    // The reason detection is a cascade. On a Trading Paints-populated folder the most
    // frequent customer id belongs to whoever you have raced most, not to you. If this
    // ever stops being true the extra machinery is still harmless, so this only reports.
    let Some(paint) = paths::detect().chosen else {
        return;
    };
    let report = customer::detect(std::path::Path::new(&paint));
    let (Some(detected), Some(most_frequent)) = (
        report.id.as_deref(),
        report
            .candidates
            .iter()
            .max_by_key(|c| c.paints)
            .map(|c| c.id.as_str()),
    ) else {
        return;
    };

    println!("\n-- why detection is not just a frequency count --");
    println!("  detected:      {detected}");
    println!("  most frequent: {most_frequent}");
    if detected == most_frequent {
        println!("  they agree on this machine.");
    } else {
        let rank = {
            let mut sorted = report.candidates.clone();
            sorted.sort_by(|a, b| b.paints.cmp(&a.paints));
            sorted.iter().position(|c| c.id == detected).map(|i| i + 1)
        };
        println!(
            "  they disagree: the real id ranks {:?} of {} by frequency.",
            rank,
            report.candidates.len()
        );
    }
}

#[test]
#[ignore = "reads the real iRacing install"]
fn reads_the_trading_paints_setup() {
    let tp = tradingpaints::inspect();
    println!("\n-- trading paints --");
    println!("  config found: {}", tp.config_found);
    println!("  config path:  {:?}", tp.config_path);
    println!("  running:      {}", tp.running);
    println!("  user id:      {:?}", tp.user_id);
    println!("  download my schemes:        {:?}", tp.download_my_schemes);
    println!("  delete before downloading:  {:?}", tp.delete_before_downloading);
    println!("  delete once session ends:   {:?}", tp.delete_after_session);
    println!("  keep synced from website:   {:?}", tp.keep_synced);
    for w in &tp.warnings {
        println!("  WARNING: {w}");
    }

    if tp.config_found {
        if let Some(id) = &tp.user_id {
            assert!(customer::is_valid(id));
        }
    }
}

#[test]
#[ignore = "reads the real iRacing install"]
fn checks_whether_the_sim_is_running() {
    let state = process::sim_state();
    println!("\n-- processes --");
    println!("  sim running: {}", state.sim_running);
    println!("  ui running:  {}", state.ui_running);
    println!("  matched:     {:?}", state.matched);
    // The check itself must work even when nothing is running.
    assert!(!process::is_running("doooom-definitely-not-a-process.exe"));
}

#[test]
#[ignore = "reads the real iRacing install"]
fn scans_the_doooom_liveries_repo_as_a_library() {
    // The design pipeline's output is meant to drop straight in as a library.
    let Some(paint) = paths::detect().chosen else {
        return;
    };
    let paint = std::path::PathBuf::from(paint);
    let candidate = paint.join("doooom-iRacing-liveries").join("cars");
    if !candidate.is_dir() {
        println!("no liveries repo at {}; skipping", candidate.display());
        return;
    }

    let lib = library::scan(&candidate, Some(&paint)).unwrap();
    println!("\n-- library at {} --", candidate.display());
    for car in &lib.cars {
        println!(
            "  {:<16} -> sim folder {:?}{}",
            car.folder,
            car.sim_folder,
            if car.sim_folder_inferred {
                "  (matched loosely)"
            } else {
                ""
            }
        );
        for v in &car.versions {
            println!(
                "      {:<26} {:<18} {} preview(s){}",
                v.id,
                v.files
                    .iter()
                    .map(|f| f.role.as_str())
                    .collect::<Vec<_>>()
                    .join("+"),
                v.previews.len(),
                if v.problems.is_empty() {
                    String::new()
                } else {
                    format!("  PROBLEMS: {:?}", v.problems)
                }
            );
        }
    }
    for n in &lib.notes {
        println!("  note: {n}");
    }

    assert!(!lib.cars.is_empty(), "the liveries repo should scan as cars");
    // Every car in that repo has at least one version with a paint in it.
    for car in &lib.cars {
        assert!(
            car.versions.iter().any(|v| v.has_paint),
            "{} has no version with a car paint",
            car.folder
        );
    }
}
