//! Native folder import and file saving.
//!
//! The import walker is deliberately conservative: generated or vendored
//! directories are skipped, single files are size-capped, and the whole import
//! is capped twice more (count and total bytes) so an accidental `node_modules`
//! can flood neither memory nor the front end.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// Directories that are never interesting to import.
const SKIPPED_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", "dist-server", "build", "out", ".next", ".venv",
    "venv", "__pycache__", ".cache", "coverage", ".idea", ".vscode", ".freebuff",
    ".freebuff-workspace", ".freebuff-build",
];

const MAX_FILE_BYTES: u64 = 512 * 1024;
const MAX_FILES: usize = 1500;
const MAX_TOTAL_BYTES: u64 = 24 * 1024 * 1024;
const MAX_DEPTH: usize = 24;

#[derive(Serialize)]
pub struct ImportedFile {
    pub path: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct ImportedProject {
    pub name: String,
    pub files: Vec<ImportedFile>,
}

/// Walks `root` and reads every small enough text file. Files that are not
/// valid UTF-8 are skipped rather than mangled.
pub fn collect_project_files(root: &Path) -> Result<ImportedProject, String> {
    if !root.is_dir() {
        return Err(format!("{} is not a directory", root.display()));
    }

    let name = root
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "project".to_string());

    let mut files: Vec<ImportedFile> = Vec::new();
    let mut total_bytes: u64 = 0;
    // Explicit stack instead of recursion; (directory, relative prefix, depth).
    let mut stack: Vec<(PathBuf, String, usize)> = vec![(root.to_path_buf(), String::new(), 0)];

    while let Some((dir, prefix, depth)) = stack.pop() {
        if depth > MAX_DEPTH || files.len() >= MAX_FILES || total_bytes >= MAX_TOTAL_BYTES {
            continue;
        }
        let read_dir = match fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        let mut entries: Vec<_> = read_dir.flatten().collect();
        entries.sort_by_key(|e| e.file_name());

        for entry in entries {
            if files.len() >= MAX_FILES || total_bytes >= MAX_TOTAL_BYTES {
                break;
            }
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            let file_name = entry.file_name().to_string_lossy().into_owned();
            let relative = if prefix.is_empty() {
                file_name.clone()
            } else {
                format!("{prefix}/{file_name}")
            };

            if file_type.is_dir() {
                if SKIPPED_DIRS.contains(&file_name.as_str()) {
                    continue;
                }
                stack.push((entry.path(), relative, depth + 1));
            } else if file_type.is_file() {
                let meta = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if meta.len() > MAX_FILE_BYTES {
                    continue;
                }
                let bytes = match fs::read(entry.path()) {
                    Ok(b) => b,
                    Err(_) => continue,
                };
                if total_bytes + bytes.len() as u64 > MAX_TOTAL_BYTES {
                    continue;
                }
                let Ok(content) = String::from_utf8(bytes) else {
                    continue;
                };
                total_bytes += content.len() as u64;
                files.push(ImportedFile {
                    path: relative,
                    content,
                });
            }
        }
    }

    Ok(ImportedProject { name, files })
}

/// Writes text through the save dialog's chosen path.
pub fn save_text(target: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(target, content).map_err(|e| e.to_string())
}
