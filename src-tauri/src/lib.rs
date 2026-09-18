use serde::Serialize;
use std::{collections::HashMap, fs, net::TcpListener, path::{Path, PathBuf}, process::{Child, Command}, sync::Mutex};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

const MAX_FILE_BYTES: u64 = 2_000_000;

pub struct ProcessRecord { child: Child, kind: String, command: String, root: String }
pub struct AppState { processes: Mutex<HashMap<u32, ProcessRecord>> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry { pub path: String, pub kind: String, pub size: Option<u64> }
#[derive(Serialize)]
pub struct GitStatusEntry { pub path: String, pub status: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus { pub branch: String, pub entries: Vec<GitStatusEntry>, pub ahead: u32, pub behind: u32, pub clean: bool }
#[derive(Serialize)]
pub struct CommandResult { pub code: i32, pub stdout: String, pub stderr: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo { pub pid: u32, pub kind: String, pub command: String, pub root: String, pub running: bool }

fn protected(path: &Path) -> Result<(), String> {
    for part in path.to_string_lossy().replace('\\', "/").split('/') {
        if part == ".git" || part == "node_modules" || part == ".env" || part.starts_with(".env.") { return Err("Доступ к защищённому пути запрещён".into()); }
    }
    Ok(())
}
fn resolve(root: &str, value: &str, exists: bool) -> Result<PathBuf, String> {
    let base = fs::canonicalize(root).map_err(|_| "Workspace не найден".to_string())?;
    let raw = Path::new(value);
    let candidate = if raw.is_absolute() { raw.to_path_buf() } else { base.join(raw) };
    protected(&candidate)?;
    let result = if exists { fs::canonicalize(&candidate).map_err(|_| "Файл не найден".to_string())? } else {
        let parent = candidate.parent().ok_or("Некорректный путь")?;
        fs::canonicalize(parent).map_err(|_| "Папка назначения не найдена".to_string())?.join(candidate.file_name().ok_or("Некорректное имя файла")?)
    };
    if !result.starts_with(&base) { return Err("Путь выходит за пределы workspace".into()); }
    Ok(result)
}
fn walk(base: &Path, current: &Path, out: &mut Vec<FileEntry>) -> Result<(), String> {
    for item in fs::read_dir(current).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?; let path = item.path(); let name = item.file_name().to_string_lossy().to_string();
        if name == ".git" || name == "node_modules" || name == ".env" || name.starts_with(".env.") { continue; }
        let meta = item.metadata().map_err(|e| e.to_string())?;
        if meta.is_dir() { walk(base, &path, out)?; } else if meta.is_file() { out.push(FileEntry { path: path.strip_prefix(base).unwrap_or(&path).to_string_lossy().replace('\\', "/"), kind: "file".into(), size: Some(meta.len()) }); }
    }
    Ok(())
}

#[tauri::command]
fn workspace_pick(app: AppHandle) -> Option<String> { app.dialog().file().blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string()) }
#[tauri::command]
fn workspace_list_files(root: String) -> Result<Vec<FileEntry>, String> { let base = fs::canonicalize(root).map_err(|e| e.to_string())?; let mut out = Vec::new(); walk(&base, &base, &mut out)?; out.sort_by(|a,b| a.path.cmp(&b.path)); Ok(out) }
#[tauri::command]
fn workspace_read_file(root: String, path: String) -> Result<String, String> { let path = resolve(&root, &path, true)?; if fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_FILE_BYTES { return Err("Файл слишком большой".into()); } fs::read_to_string(path).map_err(|_| "Файл не является текстовым".into()) }
#[tauri::command]
fn workspace_write_file(root: String, path: String, content: String) -> Result<(), String> { if content.len() as u64 > MAX_FILE_BYTES { return Err("Файл слишком большой".into()); } fs::write(resolve(&root, &path, false)?, content).map_err(|e| e.to_string()) }
#[tauri::command]
fn workspace_delete_file(root: String, path: String) -> Result<(), String> { let path = resolve(&root, &path, true)?; if path.is_dir() { return Err("Удаление папок запрещено".into()); } fs::remove_file(path).map_err(|e| e.to_string()) }

fn git(root: &str, args: &[&str]) -> Result<CommandResult, String> { let dir = fs::canonicalize(root).map_err(|e| e.to_string())?; let out = Command::new("git").args(args).current_dir(dir).output().map_err(|e| format!("Git недоступен: {e}"))?; Ok(CommandResult { code: out.status.code().unwrap_or(-1), stdout: String::from_utf8_lossy(&out.stdout).into(), stderr: String::from_utf8_lossy(&out.stderr).into() }) }
#[tauri::command]
fn git_status(root: String) -> Result<GitStatus, String> { let branch = git(&root, &["branch", "--show-current"])?; let raw = git(&root, &["status", "--porcelain"])?; if raw.code != 0 { return Err(raw.stderr); } let entries = raw.stdout.lines().filter_map(|line| if line.len() < 4 { None } else { let status = match &line[..2] { "??" => "untracked", " D"|"D " => "deleted", "R " => "renamed", "A " => "added", _ => "modified" }; Some(GitStatusEntry { status: status.into(), path: line[3..].into() }) }).collect::<Vec<_>>(); Ok(GitStatus { branch: branch.stdout.trim().into(), clean: entries.is_empty(), entries, ahead: 0, behind: 0 }) }
#[tauri::command]
fn git_diff(root: String) -> Result<String, String> { Ok(git(&root, &["diff", "--no-ext-diff"])?.stdout) }
#[tauri::command]
fn git_commit(root: String, message: String) -> Result<CommandResult, String> { let added = git(&root, &["add", "--all"])?; if added.code != 0 { return Ok(added); } git(&root, &["commit", "-m", &message]) }
#[tauri::command]
fn git_branches(root: String) -> Result<Vec<String>, String> { Ok(git(&root, &["for-each-ref", "--format=%(refname:short)", "refs/heads"])?.stdout.lines().map(str::to_owned).filter(|s| !s.is_empty()).collect()) }
#[tauri::command] fn git_checkout(root: String, branch: String) -> Result<CommandResult, String> { if branch.is_empty() || branch.len() > 120 || branch.chars().any(|c| c.is_whitespace() || matches!(c, '~' | '^' | ':' | '?' | '*' | '[' | '\\')) { return Err("Некорректное имя ветки".into()); } git(&root, &["checkout", &branch]) }
#[tauri::command] fn git_create_branch(root: String, branch: String) -> Result<CommandResult, String> { if branch.is_empty() || branch.len() > 120 || branch.chars().any(|c| c.is_whitespace() || matches!(c, '~' | '^' | ':' | '?' | '*' | '[' | '\\')) { return Err("Некорректное имя ветки".into()); } git(&root, &["switch", "-c", &branch]) }
#[tauri::command] fn git_pull(root: String) -> Result<CommandResult, String> { git(&root, &["pull"]) }
#[tauri::command] fn git_push(root: String) -> Result<CommandResult, String> { git(&root, &["push"]) }
#[tauri::command] fn git_stash(root: String) -> Result<CommandResult, String> { git(&root, &["stash", "push", "-u"]) }

#[tauri::command]
fn terminal_run(root: String, command: String, args: Vec<String>, approved: bool) -> Result<CommandResult, String> { if command.len() > 64 || args.len() > 32 || command.contains('/') || args.iter().any(|arg| arg.len() > 512 || arg.chars().any(|c| matches!(c, ';' | '|' | '&' | '>' | '<' | '$'))) { return Err("Команда содержит запрещённые элементы".into()); } let safe = matches!(command.as_str(), "pwd" | "ls" | "find" | "git" | "bun" | "npm" | "pnpm"); if !approved && !safe { return Err("Команда требует подтверждения".into()); } let dir = fs::canonicalize(root).map_err(|e| e.to_string())?; let out = Command::new(command).args(args).current_dir(dir).output().map_err(|e| e.to_string())?; let limit = 256 * 1024; let stdout = String::from_utf8_lossy(&out.stdout[..out.stdout.len().min(limit)]).into(); let stderr = String::from_utf8_lossy(&out.stderr[..out.stderr.len().min(limit)]).into(); Ok(CommandResult { code: out.status.code().unwrap_or(-1), stdout, stderr }) }
#[tauri::command]
fn preview_start(state: State<'_, AppState>, root: String, command: Option<String>) -> Result<serde_json::Value, String> { if TcpListener::bind("127.0.0.1:5173").is_err() { return Err("Порт 5173 уже занят".into()); } let dir = fs::canonicalize(root).map_err(|e| e.to_string())?; let line = command.unwrap_or_else(|| "bun run dev".into()); let mut parts = line.split_whitespace(); let executable = parts.next().ok_or("Команда пуста")?; let child = Command::new(executable).args(parts).current_dir(&dir).spawn().map_err(|e| e.to_string())?; let pid = child.id(); state.processes.lock().map_err(|_| "Process manager недоступен")?.insert(pid, ProcessRecord { child, kind: "preview".into(), command: line, root: dir.to_string_lossy().into() }); Ok(serde_json::json!({"url":"http://localhost:5173","pid":pid})) }
#[tauri::command]
fn process_list(state: State<'_, AppState>) -> Result<Vec<ProcessInfo>, String> { let mut map = state.processes.lock().map_err(|_| "Process manager недоступен")?; let mut done = Vec::new(); let mut out = Vec::new(); for (pid, record) in map.iter_mut() { let running = record.child.try_wait().map_err(|e| e.to_string())?.is_none(); if !running { done.push(*pid); } out.push(ProcessInfo { pid: *pid, kind: record.kind.clone(), command: record.command.clone(), root: record.root.clone(), running }); } for pid in done { map.remove(&pid); } Ok(out) }
#[tauri::command]
fn process_stop(state: State<'_, AppState>, pid: u32) -> Result<(), String> { let mut map = state.processes.lock().map_err(|_| "Process manager недоступен")?; let mut record = map.remove(&pid).ok_or("Процесс не найден")?; record.child.kill().map_err(|e| e.to_string())?; let _ = record.child.wait(); Ok(()) }

pub fn run() { tauri::Builder::default().plugin(tauri_plugin_dialog::init()).manage(AppState { processes: Mutex::new(HashMap::new()) }).invoke_handler(tauri::generate_handler![workspace_pick,workspace_list_files,workspace_read_file,workspace_write_file,workspace_delete_file,git_status,git_diff,git_commit,git_branches,git_checkout,git_create_branch,git_pull,git_push,git_stash,terminal_run,preview_start,process_list,process_stop]).run(tauri::generate_context!()).expect("error while running RBuilder Desktop"); }
