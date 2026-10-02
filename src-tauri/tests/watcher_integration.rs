//! Proves the native watcher actually delivers events on this platform.
//!
//! The unit tests in `folder_watch` cover which events are worth reporting, but
//! they construct those events by hand. That would pass just as happily on a
//! machine where the OS backend delivers nothing at all, which is the one failure
//! that matters here: a watcher that silently never fires looks exactly like a
//! watcher nobody edited anything in.
//!
//! So this watches a real directory, writes a real file, and waits for the OS to
//! report it.

use notify::{EventKind, RecursiveMode, Watcher};
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::Duration;

/// Generous: CI runners are slow, and a missing event must be a real failure
/// rather than a slow machine.
const TIMEOUT: Duration = Duration::from_secs(20);

fn scratch(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("rbuilder-watch-live-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    root
}

#[test]
fn the_os_reports_a_file_written_in_a_watched_directory() {
    let root = scratch("write");

    let (tx, rx) = channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(move |result| {
        let _ = tx.send(result);
    })
    .expect("the platform must provide a watcher backend");
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .expect("the directory must be watchable");

    let file = root.join("index.html");
    fs::write(&file, "<h1>hi</h1>").unwrap();

    let mut saw_write = false;
    let deadline = std::time::Instant::now() + TIMEOUT;
    while std::time::Instant::now() < deadline && !saw_write {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(Ok(event)) => {
                if matches!(event.kind, EventKind::Access(_)) {
                    continue;
                }
                if event.paths.iter().any(|path| path.ends_with("index.html")) {
                    saw_write = true;
                }
            }
            Ok(Err(_)) => continue,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    let _ = fs::remove_dir_all(&root);
    assert!(
        saw_write,
        "the OS watcher reported nothing for a file it should have seen"
    );
}

#[test]
fn the_os_reports_a_file_created_in_a_new_subdirectory() {
    // Recursive watching is the point: a file the user creates in a folder that
    // did not exist when the watch started still has to be reported.
    let root = scratch("nested");

    let (tx, rx) = channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(move |result| {
        let _ = tx.send(result);
    })
    .expect("the platform must provide a watcher backend");
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .expect("the directory must be watchable");

    let nested = root.join("src");
    fs::create_dir_all(&nested).unwrap();
    let file = nested.join("app.ts");
    fs::write(&file, "export const a = 1").unwrap();

    let mut saw_write = false;
    let deadline = std::time::Instant::now() + TIMEOUT;
    while std::time::Instant::now() < deadline && !saw_write {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(Ok(event)) => {
                if matches!(event.kind, EventKind::Access(_)) {
                    continue;
                }
                if event.paths.iter().any(|path| path.ends_with("app.ts")) {
                    saw_write = true;
                }
            }
            Ok(Err(_)) => continue,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    let _ = fs::remove_dir_all(&root);
    assert!(
        saw_write,
        "a file in a directory created after the watch started was not reported"
    );
}