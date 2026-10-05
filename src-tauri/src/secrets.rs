//! Where the GitHub token is kept.
//!
//! The token is a credential, so it does not belong in web storage: anything
//! that can run script in the window can read `localStorage`, and a token that
//! is only ever written to a file in the app's own data directory stays out of
//! both the window and the project it is syncing.

use std::fs;
use std::path::{Path, PathBuf};

/// The file inside the app data directory that holds the token.
const FILE_NAME: &str = "github-token.txt";

fn token_path(app_data: &Path) -> PathBuf {
    app_data.join(FILE_NAME)
}

/// Reads the stored token, or None when there is none or it cannot be read.
/// A token that cannot be read is treated as absent: the panel asks again
/// rather than failing every sync.
pub fn read(app_data: &Path) -> Option<String> {
    let raw = fs::read_to_string(token_path(app_data)).ok()?;
    let token = raw.trim().to_string();
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

/// Stores the token, or removes it when given None (signing out).
pub fn write(app_data: &Path, token: Option<&str>) -> Result<(), String> {
    let path = token_path(app_data);
    match token {
        Some(value) => {
            fs::create_dir_all(app_data)
                .map_err(|e| format!("{}: {e}", app_data.to_string_lossy()))?;
            fs::write(&path, value.trim())
                .map_err(|e| format!("{}: {e}", path.to_string_lossy()))?;
            restrict(&path);
            Ok(())
        }
        None => match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            // Signing out of an app that was never signed in is not a failure.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("{}: {e}", path.to_string_lossy())),
        },
    }
}

/// Owner-only where the platform has such a thing. A failure here is not worth
/// reporting: the token is already written, and on Windows there is nothing to
/// set anyway.
fn restrict(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rb-secret-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_fresh_install_has_no_token() {
        let dir = temp_dir("fresh");
        assert_eq!(read(&dir), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn round_trips_and_forgets() {
        let dir = temp_dir("round-trip");
        write(&dir, Some("ghp_example")).unwrap();
        assert_eq!(read(&dir).as_deref(), Some("ghp_example"));
        write(&dir, Some("  ghp_padded  ")).unwrap();
        assert_eq!(read(&dir).as_deref(), Some("ghp_padded"));
        write(&dir, None).unwrap();
        assert_eq!(read(&dir), None);
        // Signing out twice is not an error.
        write(&dir, None).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }
}