//! The RBUILDER desktop shell.
//!
//! Tauri starts the bundled production server (the sidecar) on a free local
//! port, waits until it is healthy, and only then opens the window, pointing
//! the front end at the server through `window.__RBUILDER_API_BASE__`.
//! The shell also provides the two things a plain browser cannot do well:
//! native folder import and a real save dialog.

mod sidecar;
mod workspace_files;

use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use workspace_files::ImportedProject;

/// State shared across the app lifetime. The server guard lives here, so the
/// process stays alive for exactly as long as the app does.
pub struct AppState {
    server: Mutex<Option<sidecar::SidecarGuard>>,
    #[allow(dead_code)]
    port: u16,
}

#[tauri::command]
async fn pick_project_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    // `blocking_*` is fine here: async commands run off the main thread.
    let picked = app.dialog().file().blocking_pick_folder();
    Ok(picked.map(|p| p.to_string()))
}

#[tauri::command]
async fn read_project_files(path: String) -> Result<ImportedProject, String> {
    workspace_files::collect_project_files(std::path::Path::new(&path))
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
            read_project_files,
            write_project_files,
            delete_project_file,
            save_text_file
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
