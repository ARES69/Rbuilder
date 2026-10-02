//! Watches the bound project folder for changes made outside the app.
//!
//! The watcher polls a fingerprint of the tree instead of subscribing to OS
//! notifications: `notify` would be the textbook choice, but it drags in a
//! dependency tree that has to build on three platforms, and the app already
//! polls git after every turn. A fingerprint of (path, size, mtime) catches
//! everything an editor or a build script does to a source file, and the poll
//! interval is long enough that a busy `npm install` costs a few stat calls.
//!
//! The event carries no file list on purpose. The front end re-reads the folder
//! through the same `read_project_files` walker used at launch, so there is one
//! code path for "what is on disk" and no second answer to keep in sync.

use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};

use crate::workspace_files::SKIPPED_DIRS;

/// The event the front end listens for. Matches the `rbuilder:` prefix used by
/// the git panel's own notification.
pub const FOLDER_CHANGED_EVENT: &str = "rbuilder://folder-changed";

/// How often the tree is fingerprinted. Fast enough that an edit shows up while
/// the user is still looking at the editor, slow enough to stay invisible on
/// the CPU while a build rewrites `dist/`.
const POLL_INTERVAL: Duration = Duration::from_millis(1_500);

const MAX_DEPTH: usize = 24;
/// A tree bigger than this is not something to poll; the import walker has the
/// same ceiling, so a folder this large was never a real project here.
const MAX_ENTRIES: usize = 4_000;

#[derive(Clone, Serialize)]
pub struct FolderChanged {
    pub root: String,
}

/// Runs until `stop` flips. Holds the join handle so the watcher can be shut
/// down cleanly instead of being left to a detached thread.
pub struct FolderWatch {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl FolderWatch {
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            // The poll sleeps in short slices, so the wait is bounded.
            let _ = handle.join();
        }
    }
}

impl Drop for FolderWatch {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Starts polling `root`, emitting [`FOLDER_CHANGED_EVENT`] whenever its
/// fingerprint moves. Returns an error if the folder is gone or unreadable.
pub fn start(app: AppHandle, root: String) -> Result<FolderWatch, String> {
    let path = Path::new(&root);
    if !path.is_dir() {
        return Err(format!("{root} is not a directory"));
    }
    // The baseline is taken up front, so the app's own write into the folder
    // (the model writing files) does not read as an external edit.
    let mut last = fingerprint(path).ok_or_else(|| format!("could not read {root}"))?;

    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let watch_root = root.clone();

    let handle = std::thread::spawn(move || {
        while !flag.load(Ordering::SeqCst) {
            // Short sleeps keep `stop` responsive without a condvar.
            for _ in 0..(POLL_INTERVAL.as_millis() / 100) {
                if flag.load(Ordering::SeqCst) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            if flag.load(Ordering::SeqCst) {
                return;
            }
            let Some(current) = fingerprint(Path::new(&watch_root)) else {
                // The folder was removed or is temporarily unreadable (a network
                // share, a rename in progress). Keep the last fingerprint and
                // try again rather than firing a spurious change.
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

/// A stable digest of the tree's (relative path, size, mtime) triples.
///
/// Content is not hashed: reading every file on each poll would turn a large
/// project into a disk-bound loop, and mtime plus size catches edits in
/// practice. A write that keeps both identical would slip through, which no
/// ordinary editor does.
pub fn fingerprint(root: &Path) -> Option<u64> {
    let mut entries: Vec<(String, u64, u128)> = Vec::new();
    collect(root, "", 0, &mut entries)?;
    // Order comes from the walk, but sorting makes the digest independent of
    // the order the filesystem happened to hand entries back.
    entries.sort();
    let mut hasher = DefaultHasher::new();
    entries.hash(&mut hasher);
    Some(hasher.finish())
}

fn collect(
    dir: &Path,
    prefix: &str,
    depth: usize,
    out: &mut Vec<(String, u64, u128)>,
) -> Option<()> {
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

        // Skipped by name regardless of kind: a git worktree or submodule has
        // `.git` as a *file*, and counting one would make the digest move for
        // a checkout the user never edited.
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
            // Nanoseconds where the platform offers them, so two edits inside
            // the same poll window still move the digest.
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
    use std::env::temp_dir;
    use std::fs;

    fn scratch(name: &str) -> std::path::PathBuf {
        let root = temp_dir().join(format!("rbuilder-watch-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
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
        let root = scratch("add-remove");
        let empty = fingerprint(&root).unwrap();

        fs::write(root.join("a.txt"), "a").unwrap();
        let with_a = fingerprint(&root).unwrap();
        assert_ne!(with_a, empty);

        fs::remove_file(root.join("a.txt")).unwrap();
        assert_eq!(fingerprint(&root).unwrap(), empty);
    }

    #[test]
    fn fingerprint_ignores_generated_directories() {
        let root = scratch("skipped");
        let before = fingerprint(&root).unwrap();

        let vendor = root.join("node_modules");
        fs::create_dir_all(&vendor).unwrap();
        fs::write(vendor.join("index.js"), "module.exports = 1").unwrap();
        fs::create_dir_all(root.join("dist")).unwrap();
        fs::write(root.join("dist").join("app.js"), "built").unwrap();

        assert_eq!(fingerprint(&root).unwrap(), before);
        fs::remove_dir_all(&root).ok();
    }

    /// A linked worktree or submodule stores `.git` as a file, not a directory.
    #[test]
    fn fingerprint_ignores_a_git_file() {
        let root = scratch("gitfile");
        fs::write(root.join("index.html"), "<h1>hi</h1>").unwrap();
        let before = fingerprint(&root).unwrap();

        fs::write(root.join(".git"), "gitdir: C:/repo/.git/worktrees/wt").unwrap();
        assert_eq!(fingerprint(&root).unwrap(), before);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn fingerprint_is_none_for_a_missing_folder() {
        assert_eq!(fingerprint(&temp_dir().join("rbuilder-does-not-exist")), None);
    }
}