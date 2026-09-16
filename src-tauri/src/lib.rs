use serde::Serialize;
use std::{collections::HashMap, fs, path::{Path, PathBuf}, process::{Child, Command}, sync::Mutex};
use tauri::{State};
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    processes: Mutex<HashMap<u32, Child>>,
}

const MAX_FILE_BYTES: u64 = 2_000_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub kind: String,
    pub size: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct GitStatusEntry {
    pub path: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub entries: Vec<GitStatusEntry>,
    pub ahead: u32,
    pub behind: u32,
    pub clean: bool,
}

#[derive(Debug, Serialize)]
pub struct CommandResult {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub kind: String,
    pub command: String,
    pub root: String,
    pub running: bool,
}

fn reject_protected(path: &Path) -> Result<(), String> {
    let normalized = path.to_string_lossy().replace('\\', "/");
    for part in normalized.split('/') {
        if part == ".git" || part == "node_modules" || part == ".env" || part.starts_with(".env.") {
            return Err("Доступ к защищённому пути запрещён".into());
        }
    }
    Ok(())
}

fn workspace_path(root: &str, path: &str, must_exist: bool) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|_| "Рабочая папка не найдена".to_string())?;
    let candidate = Path::new(path);
    let resolved = if candidate.is_absolute() { candidate.to_path_buf() } else { root.join(candidate) };
    reject_protected(&resolved)?;
    let checked = if must_exist {
        fs::canonicalize(&resolved).map_err(|_| "Файл не найден".to_string())?
    } else {
        let parent = resolved.parent().ok_or("Некорректный путь")?;
        let canonical_parent = fs::canonicalize(parent).map_err(|_| "Папка назначения не найдена".to_string())?;
        canonical_parent.join(resolved.file_name().ok_or("Некорректное имя файла")?)
    };
    if !checked.starts_with(&root) { return Err("Путь выходит за пределы workspace".into()); }
    Ok(checked)
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

fn collect_files(root: &Path, current: &Path, result: &mut Vec<FileEntry>) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".git" || name == "node_modules" || name == ".env" || name.starts_with(".env.") { continue; }
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        if metadata.is_dir() {
            collect_files(root, &path, result)?;
        } else if metadata.is_file() {
            result.push(FileEntry { path: relative(root, &path), kind: "file".into(), size: Some(metadata.len()) });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn workspace_pick(app: tauri::AppHandle) -> Option<String> {
    app.dialog().file().blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn workspace_list_files(root: String) -> Result<Vec<FileEntry>, String> {
    let root_path = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    collect_files(&root_path, &root_path, &mut result)?;
    result.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}

#[tauri::command]
pub fn workspace_read_file(root: String, path: String) -> Result<String, String> {
    let target = workspace_path(&root, &path, true)?;
    let metadata = fs::metadata(&target).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_FILE_BYTES { return Err("Файл слишком большой для редактора".into()); }
    fs::read_to_string(target).map_err(|_| "Файл не является текстовым".into())
}

#[tauri::command]
pub fn workspace_write_file(root: String, path: String, content: String) -> Result<(), String> {
    if content.len() as u64 > MAX_FILE_BYTES { return Err("Файл превышает допустимый размер".into()); }
    let target = workspace_path(&root, &path, false)?;
    fs::write(target, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn workspace_delete_file(root: String, path: String) -> Result<(), String> {
    let target = workspace_path(&root, &path, true)?;
    if target.is_dir() { return Err("Удаление папок через bridge запрещено".into()); }
    fs::remove_file(target).map_err(|e| e.to_string())
}

fn run_git(root: &str, args: &[&str]) -> Result<CommandResult, String> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let output = Command::new("git").args(args).current_dir(root).output().map_err(|e| format!("Git недоступен: {e}"))?;
    Ok(CommandResult { code: output.status.code().unwrap_or(-1), stdout: String::from_utf8_lossy(&output.stdout).to_string(), stderr: String::from_utf8_lossy(&output.stderr).to_string() })
}

#[tauri::command]
pub fn git_status(root: String) -> Result<GitStatus, String> {
    let branch = run_git(&root, &["branch", "--show-current"])?;
    let raw = run_git(&root, &["status", "--porcelain"])?;
    if raw.code != 0 { return Err(raw.stderr); }
    let entries = raw.stdout.lines().filter_map(|line| {
        if line.len() < 4 { return None; }
        let status = match &line[..2] { "??" => "untracked", " D" | "D " => "deleted", "R " => "renamed", "A " => "added", _ => "modified" };
        Some(GitStatusEntry { status: status.into(), path: line[3..].to_string() })
    }).collect::<Vec<_>>();
    Ok(GitStatus { branch: branch.stdout.trim().into(), clean: entries.is_empty(), entries, ahead: 0, behind: 0 })
}

#[tauri::command]
pub fn git_diff(root: String) -> Result<String, String> { Ok(run_git(&root, &["diff", "--no-ext-diff"] )?.stdout) }

#[tauri::command]
pub fn git_commit(root: String, message: String) -> Result<CommandResult, String> { run_git(&root, &["add", "--all"]).and_then(|r| if r.code == 0 { run_git(&root, &["commit", "-m", &message]) } else { Ok(r) }) }

#[tauri::command]
pub fn git_branches(root: String) -> Result<Vec<String>, String> { Ok(run_git(&root, &["for-each-ref", "--format=%(refname:short)", "refs/heads"])?.stdout.lines().map(str::to_string).filter(|s| !s.is_empty()).collect()) }

#[tauri::command]
pub fn git_checkout(root: String, branch: String) -> Result<CommandResult, String> { run_git(&root, &["checkout", &branch]) }

#[tauri::command]
pub fn git_create_branch(root: String, branch: String) -> Result<CommandResult, String> { run_git(&root, &["switch", "-c", &branch]) }

#[tauri::command]
pub fn git_pull(root: String) -> Result<CommandResult, String> { run_git(&root, &["pull"]) }

#[tauri::command]
pub fn git_push(root: String) -> Result<CommandResult, String> { run_git(&root, &["push"]) }

#[tauri::command]
pub fn git_stash(root: String) -> Result<CommandResult, String> { run_git(&root, &["stash", "push", "-u"]) }

#[tauri::command]
pub fn terminal_run(root: String, command: String, args: Vec<String>) -> Result<CommandResult, String> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let output = Command::new(&command).args(args).current_dir(root).output().map_err(|e| format!("Команда недоступна: {e}"))?;
    Ok(CommandResult { code: output.status.code().unwrap_or(-1), stdout: String::from_utf8_lossy(&output.stdout).to_string(), stderr: String::from_utf8_lossy(&output.stderr).to_string() })
}

#[tauri::command]
pub fn preview_start(state: State<'_, AppState>, root: String, command: Option<String>) -> Result<serde_json::Value, String> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let line = command.unwrap_or_else(|| "bun run dev".into());
    let mut parts = line.split_whitespace();
    let executable = parts.next().ok_or("Команда preview пуста")?;
    let child = Command::new(executable).args(parts).current_dir(&root).spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    state.processes.lock().map_err(|_| "Process manager недоступен")?.insert(pid, child);
    Ok(serde_json::json!({ "url": "http://localhost:5173", "pid": pid }))
}

#[tauri::command]
pub fn process_list(state: State<'_, AppState>) -> Result<Vec<ProcessInfo>, String> {
    let mut processes = state.processes.lock().map_err(|_| "Process manager недоступен")?;
    let mut result = Vec::new();
    let mut finished = Vec::new();
    for (pid, child) in processes.iter_mut() {
        let running = child.try_wait().map_err(|e| e.to_string())?.is_none();
        if !running { finished.push(*pid); }
        result.push(ProcessInfo { pid: *pid, kind: "preview".into(), command: "preview".into(), root: String::new(), running });
    }
    for pid in finished { processes.remove(&pid); }
    Ok(result)
}

#[tauri::command]
pub fn process_stop(state: State<'_, AppState>, pid: u32) -> Result<(), String> {
    let mut processes = state.processes.lock().map_err(|_| "Process manager недоступен")?;
    let mut child = processes.remove(&pid).ok_or("Процесс не найден")?;
    child.kill().map_err(|e| e.to_string())?;
    let _ = child.wait();
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState { processes: Mutex::new(HashMap::new()) })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            workspace_pick, workspace_list_files, workspace_read_file, workspace_write_file, workspace_delete_file,
            git_status, git_diff, git_commit, git_branches, git_checkout, git_create_branch, git_pull, git_push, git_stash,
            terminal_run, preview_start, process_list, process_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running RBuilder Desktop");
}
