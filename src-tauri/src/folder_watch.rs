//! Watches the bound project folder for changes made outside the app.
//!
//! This uses the OS's own filesystem notifications (`notify`: ReadDirectoryChangesW
//! on Windows, FSEvents on macOS, inotify on Linux) rather than polling.
//!
//! Two things raw notifications do not give you for free, and that most of this
//! file exists to handle:
//!
//! - **Editors do not save once.** A single save is a create, a write, a rename
//!   and a metadata touch, so an undebounced watcher re-reads the project several
//!   times for one save. Events are collected and flushed once things go quiet.
//! - **Not every event is a change worth reporting.** A `node_modules` write or a
//!   `.git` update is not something to re-read the project for. Access events are
//!   dropped too: opening a file in an editor is not a change to it.
//!
//! The fingerprint from the polling implementation is kept, but for a different
//! reason: it is a cheap guard against re-reading when the net effect of a burst
//! of events was no change at all — a `touch`, or a build writing a file it then
//! deletes. A watcher that fires on every event regardless is correct but busy.
//!
//! The event carries no file list on purpose. The front end re-reads the folder
//! through the same `read_project_files` walker used at launch, so there is one
//! code path for "what is on disk" and no second answer to keep in sync.

use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter};

use crate::workspace_files::SKIPPED_DIRS;

/// The event the front end listens for. Matches the `rbuilder:` prefix used by
/// the git panel's own notification.
pub const FOLDER_CHANGED_EVENT: &str = "rbuilder://folder-changed";

/// How long the tree must be quiet before a change is reported.
///
/// An editor's save arrives as a burst over a few milliseconds; a build writes
/// over seconds. 400ms keeps an edit feeling instant while still collapsing
/// each save into a single re-read.
const DEBOUNCE: Duration = Duration::from_millis(400);

/// How long to wait for the first event before looping again. Bounded so `stop`
/// is honoured promptly rather than after a long timeout.
const IDLE_WAIT: Duration = Duration::from_millis(500);

const MAX_DEPTH: usize = 24;
/// A tree bigger than this is not something to watch; the import walker has the
/// same ceiling, so a folder this large was never a real project here.
const MAX_ENTRIES: usize = 4_000;

#[derive(Clone, Serialize)]
pub struct FolderChanged {
    pub root: String,
}

/// Runs until dropped. Holds the OS watcher and the thread, so shutdown is clean
/// rather than leaving a thread and its handle behind.
pub struct FolderWatch {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl FolderWatch {
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            // The loop wakes at least every IDLE_WAIT, so the join is bounded.
            let _ = handle.join();
        }
    }
}

impl Drop for FolderWatch {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Starts watching `root`, emitting [`FOLDER_CHANGED_EVENT`] once changes stop
/// arriving. Returns an error if the folder is gone, unreadable, or unwatchable.
pub fn start(app: AppHandle, root: String) -> Result<FolderWatch, String> {
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Err(format!("{root} is not a directory"));
    }
    // The baseline is taken up front, so the app's own write into the folder
    // (the model writing files) is compared against something known.
    let baseline = fingerprint(&path).ok_or_else(|| format!("could not read {root}"))?;

    // `RecommendedWatcher` is the platform's native backend. Its callback runs on
    // the backend's own thread, so it does nothing but forward.
    let (tx, rx) = channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(move |result| {
        let _ = tx.send(result);
    })
    .map_err(|e| format!("could not create a file watcher: {e}"))?;

    watcher
        .watch(&path, RecursiveMode::Recursive)
        .map_err(|e| format!("could not watch {root}: {e}"))?;

    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let watch_root = root.clone();

    let handle = std::thread::spawn(move || {
        // Held for the thread's life: dropping it would stop the notifications.
        let _watcher = watcher;
        let mut last = baseline;

        loop {
            if flag.load(Ordering::SeqCst) {
                return;
            }
            // Blocks until something changes and the tree then stays quiet for
            // DEBOUNCE, so an edit is reported ~400ms after the last event in a
            // burst rather than after a fixed guess.
            if wait_for_quiet(&rx, &flag, &path).is_none() {
                return;
            }

            // The net effect may still be nothing: a file written and removed, or
            // a touch. Re-reading for that would be pure noise.
            let Some(current) = fingerprint(&path) else {
                // Removed, or temporarily unreadable (a network share, a rename in
                // progress). Keep the last fingerprint and try again.
                continue;
            };
            if current == last {
                continue;
            }
            last = current;

            let _ = app.emit(
                FOLDER_CHANGED_EVENT,
                FolderChanged {
                    root: watch_root.clone(),
                },
            );
        }
    });

    Ok(FolderWatch {
        stop,
        handle: Some(handle),
    })
}

/// Blocks until an event arrives and the tree then stays quiet for [`DEBOUNCE`].
///
/// Returns `None` when the watcher should stop. Each reportable event restarts
/// the quiet window, which is what collapses an editor's create/write/rename
/// burst into a single report. The wait is exactly the remaining quiet period
/// rather than a fixed interval: polling a fixed interval and re-checking the
/// clock is what would make a one-line edit arrive a second late.
fn wait_for_quiet(
    rx: &Receiver<notify::Result<Event>>,
    stop: &AtomicBool,
    root: &Path,
) -> Option<Instant> {
    // The moment the last reportable event arrived, if there has been one.
    let mut pending: Option<Instant> = None;

    loop {
        if stop.load(Ordering::SeqCst) {
            return None;
        }
        // Wait out whatever is left of the quiet window, or block for the first
        // event when there is nothing pending.
        let timeout = match pending {
            Some(since) => DEBOUNCE.saturating_sub(since.elapsed()).max(Duration::from_millis(1)),
            None => IDLE_WAIT,
        };

        match rx.recv_timeout(timeout) {
            Ok(Ok(event)) => {
                if is_worth_reporting(&event, root) {
                    pending = Some(Instant::now());
                }
            }
            Ok(Err(_)) => {
                // A backend hiccup (a watch limit on a huge tree). Stay up and let
                // the next event carry on rather than stopping the watcher.
            }
            Err(RecvTimeoutError::Timeout) => {
                // Quiet for the whole window, or idle with nothing pending.
                if pending.is_some() {
                    return Some(Instant::now());
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                // The backend is gone. Report a change that already arrived rather
                // than dropping it on the floor: a missed external edit is worse
                // than one redundant re-read.
                return pending.map(|_| Instant::now());
            }
        }
    }
}

/// Whether an event is about a file the app cares about.
///
/// Access events are ignored: opening or reading a file in an editor is not a
/// change to it, and reporting those would re-read the project every time the
/// user merely looked at a file.
fn is_worth_reporting(event: &Event, root: &Path) -> bool {
    if matches!(event.kind, EventKind::Access(_)) {
        return false;
    }
    event.paths.iter().any(|path| is_watched_path(root, path))
}

/// True when `path` is inside the watched tree and not somewhere ignored.
///
/// The check goes through `strip_prefix` and then per path segment rather than
/// comparing strings: `C:\proj2` starts with `C:\proj`, so a naive prefix test
/// would treat an unrelated folder as part of this project.
fn is_watched_path(root: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    for segment in relative.components() {
        let name = segment.as_os_str().to_string_lossy();
        // Skipped by name regardless of kind: a git worktree or submodule has
        // `.git` as a *file*, and counting one would make the watcher fire on a
        // checkout the user never edited.
        if SKIPPED_DIRS.contains(&name.as_ref()) {
            return false;
        }
    }
    true
}

/// A stable digest of the tree's (relative path, size, mtime) triples.
///
/// Content is not hashed: reading every file would turn a large project into a
/// disk-bound loop, and mtime plus size catches edits in practice.
pub fn fingerprint(root: &Path) -> Option<u64> {
    let mut entries: Vec<(String, u64, u128)> = Vec::new();
    collect(root, "", 0, &mut entries)?;
    // Sorted so the digest does not depend on the order the filesystem returned.
    entries.sort();
    let mut hasher = DefaultHasher::new();
    entries.hash(&mut hasher);
    Some(hasher.finish())
}

fn collect(dir: &Path, prefix: &str, depth: usize, out: &mut Vec<(String, u64, u128)>) -> Option<()> {
    if depth > MAX_DEPTH || out.len() >= MAX_ENTRIES {
        return Some(());
    }
    let read_dir = fs::read_dir(dir).ok()?;
    let mut entries: Vec<_> = read_dir.flatten().collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        if out.len() >= MAX_ENTRIES {
            break;
        }
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        let relative = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };

        if SKIPPED_DIRS.contains(&name.as_str()) {
            continue;
        }

        if file_type.is_dir() {
            collect(&entry.path(), &relative, depth + 1, out)?;
        } else if file_type.is_file() {
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            // Nanoseconds where the platform offers them, so two edits inside the
            // same debounce window still move the digest.
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            out.push((relative, meta.len(), modified));
        }
    }
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, DataChange, ModifyKind, RemoveKind};
    use notify::EventKind as Kind;
    use std::env::temp_dir;

    fn scratch(name: &str) -> PathBuf {
        let root = temp_dir().join(format!("rbuilder-notify-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn event(kind: Kind, paths: &[PathBuf]) -> Event {
        Event {
            kind,
            paths: paths.to_vec(),
            attrs: Default::default(),
        }
    }

    fn modify(path: &Path) -> Event {
        event(
            Kind::Modify(ModifyKind::Data(DataChange::Any)),
            &[path.to_path_buf()],
        )
    }

    #[test]
    fn ignores_access_events() {
        // Opening a file in an editor is not a change to it.
        let root = scratch("access");
        let read = event(Kind::Access(AccessKind::Read), &[root.join("a.txt")]);
        assert!(!is_worth_reporting(&read, &root));
        assert!(is_worth_reporting(&modify(&root.join("a.txt")), &root));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn reports_creates_removes_and_modifies() {
        let root = scratch("kinds");
        for kind in [
            Kind::Create(CreateKind::File),
            Kind::Modify(ModifyKind::Data(DataChange::Any)),
            Kind::Remove(RemoveKind::File),
        ] {
            assert!(is_worth_reporting(
                &event(kind, &[root.join("a.txt")]),
                &root
            ));
        }
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn ignores_generated_directories() {
        let root = scratch("ignored");
        for skipped in ["node_modules", "dist", ".git", "target"] {
            assert!(!is_worth_reporting(
                &modify(&root.join(skipped).join("file.txt")),
                &root
            ));
        }
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn ignores_a_git_file() {
        // A linked worktree or submodule stores `.git` as a file, not a directory.
        let root = scratch("gitfile");
        assert!(!is_worth_reporting(&modify(&root.join(".git")), &root));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn ignores_paths_outside_the_watched_folder() {
        let root = scratch("outside");
        let elsewhere = temp_dir().join("rbuilder-elsewhere");
        assert!(!is_worth_reporting(&modify(&elsewhere.join("a.txt")), &root));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn does_not_treat_a_sibling_folder_as_inside() {
        // `proj2` starts with the string `proj`; a prefix test would accept it.
        let base = scratch("prefix");
        let project = base.join("proj");
        let sibling = base.join("proj2");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&sibling).unwrap();
        assert!(!is_worth_reporting(
            &modify(&sibling.join("a.txt")),
            &project
        ));
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn accepts_a_nested_file_inside_the_project() {
        let root = scratch("nested");
        assert!(is_worth_reporting(
            &modify(&root.join("src").join("app.ts")),
            &root
        ));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn fingerprint_changes_when_a_file_changes() {
        let root = scratch("change");
        fs::write(root.join("index.html"), "<h1>hi</h1>").unwrap();
        let before = fingerprint(&root).unwrap();

        std::thread::sleep(Duration::from_millis(20));
        fs::write(root.join("index.html"), "<h1>hello there</h1>").unwrap();
        assert_ne!(fingerprint(&root).unwrap(), before);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn fingerprint_notices_new_and_deleted_files() {
        let root = scratch("addremove");
        let empty = fingerprint(&root).unwrap();

        fs::write(root.join("a.txt"), "a").unwrap();
        assert_ne!(fingerprint(&root).unwrap(), empty);

        fs::remove_file(root.join("a.txt")).unwrap();
        assert_eq!(fingerprint(&root).unwrap(), empty);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn fingerprint_ignores_generated_directories() {
        let root = scratch("fp-skipped");
        let before = fingerprint(&root).unwrap();

        let vendor = root.join("node_modules");
        fs::create_dir_all(&vendor).unwrap();
        fs::write(vendor.join("index.js"), "module.exports = 1").unwrap();
        fs::create_dir_all(root.join("dist")).unwrap();
        fs::write(root.join("dist").join("app.js"), "built").unwrap();

        assert_eq!(fingerprint(&root).unwrap(), before);
        fs::remove_dir_all(&root).ok();
    }

    /// An editor's save is a burst. The point of the debounce is that it arrives
    /// once, and not on every event in the burst.
    #[test]
    fn debounces_a_burst_into_one_report() {
        let root = scratch("debounce");
        let (tx, rx) = channel::<notify::Result<Event>>();
        let stop = AtomicBool::new(false);

        // Both clones stay alive for the duration: a sender dropped here would
        // disconnect the channel, which is a different case with its own test.
        let burst = tx.clone();
        // The path is cloned, not moved: the assertion below still needs `root`.
        let sender_root = root.clone();
        let sender = std::thread::spawn(move || {
            // create, write, rename, metadata — one save as the OS reports it.
            for _ in 0..4 {
                let _ = burst.send(Ok(modify(&sender_root.join("a.txt"))));
                std::thread::sleep(Duration::from_millis(50));
            }
        });

        let before = Instant::now();
        assert!(wait_for_quiet(&rx, &stop, &root).is_some());
        let elapsed = before.elapsed();

        assert!(
            elapsed >= DEBOUNCE,
            "reported after {elapsed:?}, before the tree had been quiet for {DEBOUNCE:?}"
        );
        // Four events over 200ms must not cost four debounce windows.
        assert!(
            elapsed < DEBOUNCE * 3,
            "a four-event burst took {elapsed:?}, so the events were not collapsed"
        );
        sender.join().ok();
        let _ = fs::remove_dir_all(&root);
    }

    /// A backend that goes away must not swallow an edit it already reported.
    #[test]
    fn reports_a_pending_change_when_the_backend_disconnects() {
        let root = scratch("disconnect");
        let (tx, rx) = channel::<notify::Result<Event>>();
        let stop = AtomicBool::new(false);
        let _ = tx.send(Ok(modify(&root.join("a.txt"))));
        drop(tx);

        // The channel is closed, so no further event can arrive; the change that
        // did arrive is still a change.
        assert!(wait_for_quiet(&rx, &stop, &root).is_some());
        let _ = fs::remove_dir_all(&root);
    }

    /// Nothing to report means nothing to wait for: no event, no return.
    #[test]
    fn idle_waiting_does_not_report() {
        let root = scratch("idle");
        let (_tx, rx) = channel::<notify::Result<Event>>();
        let stop = AtomicBool::new(false);
        stop.store(true, Ordering::SeqCst);
        // Stopped before the wait even starts: it must come back, not block.
        assert!(wait_for_quiet(&rx, &stop, &root).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    /// Events inside an ignored directory must not hold the debounce open.
    #[test]
    fn ignored_events_do_not_wake_the_watcher() {
        let root = scratch("ignored-events");
        let (tx, rx) = channel::<notify::Result<Event>>();
        let stop = AtomicBool::new(false);
        stop.store(true, Ordering::SeqCst);
        let _ = tx.send(Ok(modify(&root.join("node_modules").join("pkg.js"))));
        assert!(wait_for_quiet(&rx, &stop, &root).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn fingerprint_is_none_for_a_missing_folder() {
        assert_eq!(fingerprint(&temp_dir().join("rbuilder-does-not-exist")), None);
    }
}