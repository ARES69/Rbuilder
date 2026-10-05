//! Where a new task's files go when nobody is asked.
//!
//! The desktop shell used to open a folder picker for every new task, which
//! meant the first prompt of a session ended in a file dialog. Projects now land
//! in `Documents\RBuilder\<task name>` on their own, and this module owns the two
//! things that need care: turning a task name into a folder name Windows will
//! accept, and not silently reusing a folder that already exists.

use std::fs;
use std::path::{Path, PathBuf};

/// The folder every RBuilder project lives under, inside the user's documents.
pub const PROJECTS_DIR: &str = "RBuilder";

/// Long enough for any task name, short enough to stay readable in a path bar.
const MAX_NAME_CHARS: usize = 60;

/// Reserved on Windows whatever the extension: a project folder named `CON`
/// cannot be created, and `PRN` is worse — some APIs read it as the printer.
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

fn is_reserved(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name);
    RESERVED.iter().any(|word| word.eq_ignore_ascii_case(stem))
}

/**
 * Turns a task name into a folder name.
 *
 * The characters removed here are the ones no path segment may contain, not
 * just the Windows set: a name has to survive being a URL and a shell argument
 * too. Spaces and letters are kept — `Мой проект` is a folder a person can find
 * again, which is the entire point of naming it.
 */
pub fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            c if (c as u32) < 0x20 => ' ',
            c => c,
        })
        .collect();

    // Windows silently drops trailing dots and spaces, which would make the
    // folder it creates differ from the name we report back.
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']);
    let collapsed: String = trimmed
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_NAME_CHARS)
        .collect();

    let collapsed = collapsed.trim_end_matches(['.', ' ']).to_string();
    // A name made only of separators is not a name: `///` must not become a
    // folder called `---`.
    if !collapsed.chars().any(|c| c.is_alphanumeric()) {
        return "project".to_string();
    }
    // Prefixed rather than suffixed: appending to `NUL` gives `NUL-project`,
    // whose stem is still `NUL` — still the null device, still unusable.
    if is_reserved(&collapsed) {
        return format!("project-{collapsed}");
    }
    collapsed
}

/// A free folder name under `root`: the wanted one, or the first free `name 2`.
fn free_name(root: &Path, wanted: &str) -> String {
    if !root.join(wanted).exists() {
        return wanted.to_string();
    }
    for index in 2..1000 {
        let candidate = format!("{wanted} {index}");
        if !root.join(&candidate).exists() {
            return candidate;
        }
    }
    // A thousand projects of the same name is not a case worth being clever
    // about; the number only has to be unique, not pretty.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{wanted} {stamp}")
}

/// A folder the app can write to, created if it is not there yet.
pub fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("{}: {e}", path.to_string_lossy()))
}

/// Creates `Documents\RBuilder\<name>` (uniquified) and returns it with the name
/// actually used, so the task can be labelled with what is on disk.
pub fn ensure_project_folder(documents: &Path, name: &str) -> Result<(PathBuf, String), String> {
    let root = documents.join(PROJECTS_DIR);
    ensure_dir(&root)?;

    let name = free_name(&root, &sanitize(name));
    let path = root.join(&name);
    ensure_dir(&path)?;
    Ok((path, name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_an_ordinary_name() {
        assert_eq!(sanitize("Мой проект"), "Мой проект");
    }

    #[test]
    fn replaces_characters_a_path_cannot_hold() {
        assert_eq!(sanitize("a/b\\c:d*e?f"), "a-b-c-d-e-f");
    }

    #[test]
    fn collapses_whitespace_and_trims_dots() {
        assert_eq!(sanitize("  spaced   out . . "), "spaced out");
    }

    #[test]
    fn falls_back_when_nothing_is_left() {
        assert_eq!(sanitize("///"), "project");
    }

    #[test]
    fn escapes_a_reserved_device_name() {
        assert_eq!(sanitize("con"), "project-con");
        assert_eq!(sanitize("NUL.txt"), "project-NUL.txt");
        assert_eq!(sanitize("console"), "console");
    }

    #[test]
    fn caps_the_length() {
        let long = "я".repeat(200);
        assert_eq!(sanitize(&long).chars().count(), MAX_NAME_CHARS);
    }

    #[test]
    fn never_reuses_an_existing_folder() {
        let root = std::env::temp_dir().join(format!("rb-folder-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let first = free_name(&root, "project");
        assert_eq!(first, "project");
        fs::create_dir(root.join(&first)).unwrap();

        let second_name = free_name(&root, "project");
        assert_eq!(second_name, "project 2");
        fs::create_dir(&root.join(&second_name)).unwrap();
        assert_eq!(free_name(&root, "project"), "project 3");

        let _ = fs::remove_dir_all(&root);
    }
}