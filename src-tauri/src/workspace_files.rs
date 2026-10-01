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

/// Rejects absolute paths and traversal, mirroring the server's rule: a write
/// may only land inside the folder the user picked for this project.
fn safe_relative(candidate: &str) -> Result<PathBuf, String> {
    let value = candidate.trim().replace('\\', "/");
    let value = value.trim_start_matches("./").trim_start_matches('/');
    if value.is_empty() || value.contains('\u{0}') {
        return Err(format!("unsafe project path: {candidate}"));
    }
    let bytes = value.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' {
        // A drive prefix like `C:` escapes the root.
        return Err(format!("unsafe project path: {candidate}"));
    }
    if value.split('/').any(|segment| segment == "..") {
        return Err(format!("unsafe project path: {candidate}"));
    }
    Ok(PathBuf::from(value))
}

/// One file the agent wrote; mirrored into the project folder.
#[derive(serde::Deserialize)]
pub struct ProjectFileWrite {
    pub path: String,
    pub content: String,
}

/// Writes every file into `root` (creating directories as needed). Returns the
/// number of files written; a rejected path counts as an error, not a skip,
/// because the model must not silently lose work.
pub fn write_project_files(root: &Path, files: &[ProjectFileWrite]) -> Result<usize, String> {
    if !root.is_dir() {
        return Err(format!("{} is not a directory", root.display()));
    }

    let mut written = 0;
    for file in files {
        let relative = safe_relative(&file.path)?;
        let target = root.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&target, &file.content).map_err(|e| e.to_string())?;
        written += 1;
    }

    Ok(written)
}

/// Removes one file from the project folder; missing files count as removed.
pub fn delete_project_file(root: &Path, relative: &str) -> Result<bool, String> {
    if !root.is_dir() {
        return Err(format!("{} is not a directory", root.display()));
    }

    let target = root.join(safe_relative(relative)?);
    match fs::remove_file(&target) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    #[test]
    fn rejects_unsafe_paths() {
        assert!(safe_relative("../escape.txt").is_err());
        assert!(safe_relative("a/../../b").is_err());
        assert!(safe_relative("C:/windows/system32").is_err());
        assert!(safe_relative("").is_err());
        assert!(safe_relative("assets/logo.svg").is_ok());
        assert!(safe_relative("./styles.css").is_ok());
    }

    #[test]
    fn writes_and_deletes_files_in_the_folder() {
        let root = temp_dir().join(format!("rbuilder-mirror-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let files = vec![
            ProjectFileWrite { path: "index.html".into(), content: "<h1>hi</h1>".into() },
            ProjectFileWrite { path: "assets/app.js".into(), content: "console.log(1)".into() },
        ];
        assert_eq!(write_project_files(&root, &files).unwrap(), 2);
        assert!(root.join("index.html").exists());
        assert!(root.join("assets").join("app.js").exists());

        assert!(delete_project_file(&root, "index.html").unwrap());
        assert!(!root.join("index.html").exists());
        // Removing twice is not an error: the file is gone either way.
        assert!(!delete_project_file(&root, "index.html").unwrap());

        fs::remove_dir_all(&root).ok();
    }
}
