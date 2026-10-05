//! The RBUILDER desktop shell.
//!
//! Tauri starts the bundled production server (the sidecar) on a free local
//! port, waits until it is healthy, and only then opens the window, pointing
//! the front end at the server through `window.__RBUILDER_API_BASE__`.
//! The shell also provides the two things a plain browser cannot do well:
//! native folder import and a real save dialog.

mod folder_watch;
mod project_folder;
mod secrets;
mod sidecar;
mod workspace_files;

use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;
use serde::Serialize;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use workspace_files::ImportedProject;

/// State shared across the app lifetime. The server guard lives here, so the
/// process stays alive for exactly as long as the app does.
pub struct AppState {
    server: Mutex<Option<sidecar::SidecarGuard>>,
    /// At most one watcher: the front end restarts it when the bound folder
    /// changes, so a second concurrent one would only duplicate events.
    watch: Mutex<Option<folder_watch::FolderWatch>>,
    #[allow(dead_code)]
    port: u16,
}

#[tauri::command]
async fn pick_project_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    // `blocking_*` is fine here: async commands run off the main thread.
    let picked = app.dialog().file().blocking_pick_folder();
    Ok(picked.map(|p| p.to_string()))
}

/// The folder a new task is given when nobody is asked to pick one.
#[derive(Serialize)]
pub struct ProjectFolder {
    path: String,
    name: String,
}

/// Creates `Documents/RBuilder/<name>` for a new task and answers with the
/// folder that was actually taken — names are uniquified here, so the label the
/// task gets is the one on disk.
#[tauri::command]
async fn ensure_project_folder(app: tauri::AppHandle, name: String) -> Result<ProjectFolder, String> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|e| format!("cannot locate the documents folder: {e}"))?;
    let (path, name) = project_folder::ensure_project_folder(&documents, &name)?;
    Ok(ProjectFolder {
        path: path.to_string_lossy().into_owned(),
        name,
    })
}

/// The GitHub token, when one was stored. Reads never fail loudly: a token that
/// cannot be read is the same as no token.
#[tauri::command]
async fn github_token_get(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot locate the app data folder: {e}"))?;
    Ok(secrets::read(&dir))
}

/// Stores the GitHub token, or forgets it when given none.
#[tauri::command]
async fn github_token_set(app: tauri::AppHandle, token: Option<String>) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot locate the app data folder: {e}"))?;
    secrets::write(&dir, token.as_deref())
}

/// Opens a web page in the person's own browser.
///
/// A webview cannot usefully show github.com — it has no address bar, no
/// password manager and no extensions — so the few places the app links out
/// (minting a token, opening a repository) hand the page to the system instead.
/// Only http and https are accepted: this command exists to open a page, and a
/// `file://` or a program name is not one.
#[tauri::command]
async fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!("refusing to open {url}"));
    }
    let result = if cfg!(target_os = "windows") {
        std::process::Command::new("explorer").arg(&url).spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(&url).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(&url).spawn()
    };
    result.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_project_files(path: String) -> Result<ImportedProject, String> {
    workspace_files::collect_project_files(std::path::Path::new(&path))
}

/// Opens the project folder in the system file explorer.
#[tauri::command]
async fn reveal_in_explorer(path: String) -> Result<(), String> {
    let dir = std::path::PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("{} is not a directory", path));
    }

    let result = if cfg!(target_os = "windows") {
        std::process::Command::new("explorer").arg(&dir).spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(&dir).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(&dir).spawn()
    };
    result.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_project_files(
    root: String,
    files: Vec<workspace_files::ProjectFileWrite>,
) -> Result<usize, String> {
    workspace_files::write_project_files(std::path::Path::new(&root), &files)
}

#[tauri::command]
async fn delete_project_file(root: String, path: String) -> Result<bool, String> {
    workspace_files::delete_project_file(std::path::Path::new(&root), &path)
}

#[tauri::command]
async fn save_text_file(
    app: tauri::AppHandle,
    suggested_name: String,
    content: String,
) -> Result<Option<String>, String> {
    let dialog = app.dialog().file();
    let dialog = dialog.add_filter(
        "Documents",
        &["txt", "html", "md", "json", "js", "ts", "tsx", "css"],
    );
    match dialog.blocking_save_file() {
        None => Ok(None),
        Some(path) => {
            let target = PathBuf::from(path.to_string());
            workspace_files::save_text(&target, &content)?;
            Ok(Some(target.to_string_lossy().into_owned()))
        }
    }
}

/// Starts watching the bound project folder, replacing any previous watcher.
#[tauri::command]
async fn watch_project_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    root: String,
) -> Result<(), String> {
    // Stop the old watcher before starting a new one: the thread holds the
    // previous root and would keep reporting changes for a folder the user has
    // already left.
    if let Ok(mut guard) = state.watch.lock() {
        if let Some(mut previous) = guard.take() {
            previous.stop();
        }
    }
    let watch = folder_watch::start(app, root)?;
    if let Ok(mut guard) = state.watch.lock() {
        *guard = Some(watch);
    }
    Ok(())
}

/// Stops the watcher, if one is running. Idempotent: the front end calls this
/// when a task is unbound and on teardown.
#[tauri::command]
async fn unwatch_project_folder(state: tauri::State<'_, AppState>) -> Result<(), String> {
    if let Ok(mut guard) = state.watch.lock() {
        if let Some(mut watch) = guard.take() {
            watch.stop();
        }
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // A free port, picked before the server starts.
            let port = TcpListener::bind("127.0.0.1:0")
                .and_then(|listener| listener.local_addr())
                .map(|addr| addr.port())
                .unwrap_or(5185);

            let guard = sidecar::spawn_server(port).map_err(|e| e.to_string())?;
            app.manage(AppState {
                server: Mutex::new(Some(guard)),
                watch: Mutex::new(None),
                port,
            });

            // The window opens only once the API can answer.
            if !sidecar::wait_until_healthy(port) {
                return Err("the local server did not become healthy in time".into());
            }

            let init_script =
                format!("window.__RBUILDER_API_BASE__ = 'http://127.0.0.1:{port}';");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("RBuilder")
                .inner_size(1280.0, 800.0)
                .min_inner_size(940.0, 600.0)
                .initialization_script(&init_script)
                .build()?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_project_folder,
            ensure_project_folder,
            read_project_files,
            github_token_get,
            github_token_set,
            open_external,
            write_project_files,
            delete_project_file,
            reveal_in_explorer,
            save_text_file,
            watch_project_folder,
            unwatch_project_folder
        ])
        .build(tauri::generate_context!())
        .expect("error while building the tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut guard) = state.server.lock() {
                        if let Some(server) = guard.as_mut() {
                            server.kill();
                        }
                    }
                }
            }
        });
}
