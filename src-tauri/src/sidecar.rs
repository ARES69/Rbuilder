//! Starting and stopping the bundled production server (the sidecar).
//!
//! The server is compiled into a single executable with Bun. The shell points
//! it at a free port and keeps the process alive for exactly as long as the
//! app runs: dropping [`SidecarGuard`] stops it.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;

/// Owns the server process; killing it on drop is the whole point.
pub struct SidecarGuard {
    child: Child,
    #[allow(dead_code)]
    log_path: PathBuf,
}

impl SidecarGuard {
    pub fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for SidecarGuard {
    fn drop(&mut self) {
        self.kill();
    }
}

/// Locates `rbuilder-server(.exe)`:
/// 1. next to the running executable (installed builds and `tauri dev`),
/// 2. in the checkout's `.freebuff-build` (manual `cargo run` from src-tauri).
fn find_server_exe() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if let Ok(entries) = std::fs::read_dir(dir) {
                let mut hits: Vec<PathBuf> = entries
                    .flatten()
                    .filter(|e| {
                        let name = e.file_name().to_string_lossy().into_owned();
                        name.starts_with("rbuilder-server") && name.ends_with(".exe")
                    })
                    .map(|e| e.path())
                    .collect();
                if !hits.is_empty() {
                    hits.sort();
                    return Some(hits.pop().unwrap());
                }
            }
        }
    }

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev = manifest
        .join("..")
        .join(".freebuff-build")
        .join("rbuilder-server.exe");
    dev.exists().then_some(dev)
}

/// Where generated projects live. `RBUILDER_WORKSPACE_ROOT` wins, then the
/// checkout's `.freebuff-workspace` (dev), then `%LOCALAPPDATA%\RBUILDER\workspace`.
fn resolve_workspace_root() -> Result<PathBuf, String> {
    if let Ok(from_env) = std::env::var("RBUILDER_WORKSPACE_ROOT") {
        if !from_env.trim().is_empty() {
            return Ok(PathBuf::from(from_env));
        }
    }

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev = manifest.join("..").join(".freebuff-workspace");
    let root = if dev.is_dir() {
        dev
    } else {
        let base = std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."));
        base.join("RBUILDER").join("workspace")
    };

    std::fs::create_dir_all(&root)
        .map_err(|e| format!("cannot create workspace {}: {e}", root.display()))?;
    Ok(root)
}

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Spawns the bundled server on `port`. Stderr is streamed into a log file so
/// a stuck pipe can never block the server and the log survives a crash.
pub fn spawn_server(port: u16) -> Result<SidecarGuard, String> {
    let exe = find_server_exe()
        .ok_or_else(|| "rbuilder-server executable was not found next to the app".to_string())?;
    let workspace = resolve_workspace_root()?;
    let log_path = workspace.join(".rbuilder-server.log");

    let mut command = Command::new(&exe);
    command
        .env("PORT", port.to_string())
        .env("RBUILDER_WORKSPACE_ROOT", &workspace)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("cannot start {}: {e}", exe.display()))?;

    if let Some(stderr) = child.stderr.take() {
        let log_path = log_path.clone();
        thread::spawn(move || {
            use std::io::{BufRead, BufReader, Write};
            let reader = BufReader::new(stderr);
            if let Ok(mut log) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
            {
                for line in reader.lines().map_while(Result::ok) {
                    let _ = writeln!(log, "{line}");
                }
            }
        });
    }

    if let Some(stdout) = child.stdout.take() {
        thread::spawn(move || {
            use std::io::{BufRead, BufReader, Write};
            let reader = BufReader::new(stdout);
            if let Ok(mut log) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
            {
                for line in reader.lines().map_while(Result::ok) {
                    let _ = writeln!(log, "{line}");
                }
            }
        });
    }

    Ok(SidecarGuard { child, log_path })
}

/// Polls `/api/health` for up to 30 seconds.
pub fn wait_until_healthy(port: u16) -> bool {
    for _ in 0..150 {
        if http_get_ok(port, "/api/health") {
            return true;
        }
        thread::sleep(Duration::from_millis(200));
    }
    false
}

/// A dependency-free HTTP GET that answers "did it return 200?".
fn http_get_ok(port: u16, path: &str) -> bool {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(800)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));

    let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut head = String::new();
    let mut chunk = [0u8; 512];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => head.push_str(&String::from_utf8_lossy(&chunk[..n])),
            Err(_) => break,
        }
        if head.contains("\r\n\r\n") || head.len() > 4096 {
            break;
        }
    }
    head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200")
}
