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
//!
//! `--nocapture` puts everything below in a terminal, or in an agent's transcript, so none of it says a customer
//! id: the tests report whether one was found, how sure the detection is and how the candidates rank, and the
//! notes the detection writes (which name the id it found) go through `without_ids`.

use doooom_paints_lib::{customer, library, paths, process, repo, tga, tradingpaints};

/// Every id a customer report names: the one it chose and every candidate.
fn ids_in(report: &customer::CustomerReport) -> Vec<&str> {
    report
        .candidates
        .iter()
        .map(|c| c.id.as_str())
        .chain(report.id.as_deref())
        .collect()
}

/// A line of the detection's own words with the ids in it taken out. Longest first, so that an id which is the start
/// of another does not leave the rest of that one showing.
fn without_ids(text: &str, ids: &[&str]) -> String {
    let mut ids: Vec<&str> = ids.iter().copied().filter(|id| !id.is_empty()).collect();
    ids.sort_by_key(|id| std::cmp::Reverse(id.len()));
    let mut out = text.to_string();
    for id in ids {
        out = out.replace(id, "<id>");
    }
    out
}

// Not `#[ignore]`d: it reads nothing of the machine's. What the others print of an id is held here.
#[test]
fn the_report_the_tests_print_says_no_id() {
    let candidate = |id: &str, paints| customer::IdCandidate {
        id: id.to_string(),
        paints,
        local_spec_maps: 0,
        car_folders: 1,
    };
    let report = customer::CustomerReport {
        id: Some("424242".to_string()),
        confidence: Some(customer::Confidence::Certain),
        source: Some("Trading Paints downloader config".to_string()),
        // 4242421 begins with the id chosen: the longer one must go whole, not leave a digit behind.
        candidates: vec![candidate("424242", 9), candidate("4242421", 40)],
        notes: vec![
            "Trading Paints is configured for customer 424242, which is where this came from.".to_string(),
            "Customer 4242421 is the only id with spec maps in .tga form.".to_string(),
            "No id in this one.".to_string(),
        ],
    };

    let ids = ids_in(&report);
    assert_eq!(ids.len(), 3, "both candidates and the one chosen");
    let shown: Vec<String> = report.notes.iter().map(|n| without_ids(n, &ids)).collect();

    assert_eq!(
        shown,
        vec![
            "Trading Paints is configured for customer <id>, which is where this came from.",
            "Customer <id> is the only id with spec maps in .tga form.",
            "No id in this one.",
        ]
    );
    assert!(shown.iter().all(|line| !line.contains("42424")));
    assert_eq!(without_ids("nothing to hide", &[]), "nothing to hide");
}

#[test]
#[ignore = "reads the real iRacing install"]
fn renders_a_real_paint_to_png() {
    // Decoding is where a silent mistake hides: a BGR swap or a missed vertical flip both
    // produce a perfectly valid image that happens to be wrong. Writing real paints out lets
    // them be looked at rather than assumed.
    let Some(paint) = paths::detect().chosen else {
        return;
    };
    let cars = std::path::PathBuf::from(&paint)
        .join("doooom-iRacing-liveries")
        .join("cars");
    if !cars.is_dir() {
        println!("no liveries repo; skipping");
        return;
    }

    let out = std::env::temp_dir().join("doooom-tga-render");
    std::fs::create_dir_all(&out).unwrap();

    let lib = library::scan(&cars, None).unwrap();
    let mut written = 0;
    println!("\n-- rendering real paints --");
    for car in lib.cars.iter() {
        let Some(version) = car.versions.first() else {
            continue;
        };
        for file in &version.files {
            let started = std::time::Instant::now();
            let png = match tga::render_file(std::path::Path::new(&file.path), 640) {
                Ok(p) => p,
                Err(e) => {
                    println!("  {} {} FAILED: {e}", car.folder, file.file_name);
                    continue;
                }
            };
            let name = format!("{}-{}-{}.png", car.folder, version.id, file.role);
            std::fs::write(out.join(&name), &png).unwrap();
            println!(
                "  {name}  {} KB  in {} ms",
                png.len() / 1024,
                started.elapsed().as_millis()
            );
            written += 1;
        }
    }
    println!("  written to {}", out.display());
    assert!(written > 0, "nothing rendered");
}

#[test]
#[ignore = "reads the real iRacing install"]
fn finds_the_liveries_checkout_without_being_told() {
    let Some(paint) = paths::detect().chosen else {
        return;
    };
    let found = repo::suggest_libraries(std::path::Path::new(&paint));

    println!("\n-- libraries found near the sim --");
    for s in &found {
        println!("  {} ({} cars)", s.path, s.cars);
        if s.repo.is_repo {
            println!(
                "      git: {} on {}{}{}",
                s.repo.remote_url.as_deref().unwrap_or("no remote"),
                s.repo.branch.as_deref().unwrap_or("?"),
                if s.repo.behind > 0 {
                    format!(", {} behind", s.repo.behind)
                } else {
                    ", up to date".to_string()
                },
                if s.repo.dirty { ", dirty" } else { "" },
            );
        } else {
            println!("      not a git checkout");
        }
    }

    // Whatever is offered has to actually be a library, or the app would point itself at a
    // folder it cannot read.
    for s in &found {
        assert!(
            repo::looks_like_library(std::path::Path::new(&s.path)),
            "{} was suggested but does not scan as a library",
            s.path
        );
    }
    // And the sim's own paint folder must never be offered as its own library.
    assert!(
        !found.iter().any(|s| s.path.eq_ignore_ascii_case(&paint)),
        "the paint folder itself was offered as a library"
    );
}

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
    println!("  found:      {}", report.id.is_some());
    println!("  confidence: {:?}", report.confidence);
    println!("  source:     {:?}", report.source);
    let ids = ids_in(&report);
    for n in &report.notes {
        println!("  note: {}", without_ids(n, &ids));
    }
    println!("  top candidates by the plan's own heuristic (most paints wins), ids left out:");
    let mut by_paints = report.candidates.clone();
    by_paints.sort_by_key(|c| std::cmp::Reverse(c.paints));
    for (rank, c) in by_paints.iter().take(5).enumerate() {
        println!(
            "    #{:<2} {:>4} paints  {:>3} local spec maps  {:>3} car folders",
            rank + 1,
            c.paints,
            c.local_spec_maps,
            c.car_folders
        );
    }

    if let Some(id) = &report.id {
        assert!(customer::is_valid(id), "the detected id is not digits");
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
    if detected == most_frequent {
        println!("  they agree on this machine.");
    } else {
        let rank = {
            let mut sorted = report.candidates.clone();
            sorted.sort_by_key(|c| std::cmp::Reverse(c.paints));
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
    println!("  user id:      {}", if tp.user_id.is_some() { "found" } else { "none" });
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
