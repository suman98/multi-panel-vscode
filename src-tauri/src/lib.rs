mod vscode_bridge;

use std::collections::HashMap;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::Manager;

/// One code-server child process backing a single project's embedded VS Code.
struct RunningServer {
    child: Child,
    port: u16,
}

#[derive(Default)]
struct ServerRegistry(Mutex<HashMap<String, RunningServer>>);

#[derive(Serialize, Deserialize, Clone)]
struct Project {
    id: String,
    name: String,
    path: String,
    #[serde(default)]
    favorite: bool,
    /// hex accent colour chosen by the user, e.g. "#f38ec4"
    #[serde(default)]
    color: Option<String>,
    /// custom icon as a `data:image/png;base64,…` URL
    #[serde(default)]
    icon: Option<String>,
    /// ms epoch of the last time this project was selected
    #[serde(default)]
    last_opened: Option<u64>,
}

fn find_free_port() -> Result<u16, String> {
    TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("could not find a free port: {e}"))
        .map(|l| l.local_addr().unwrap().port())
}

/// Homebrew installs to different prefixes on Intel vs Apple Silicon, and a
/// GUI-launched app (double-clicked, not run from a terminal) doesn't inherit
/// the shell's PATH, so `Command::new("code-server")` alone can't be trusted.
fn resolve_code_server_bin() -> Result<PathBuf, String> {
    let candidates = [
        "/opt/homebrew/bin/code-server", // Apple Silicon Homebrew
        "/usr/local/bin/code-server",    // Intel Homebrew
        "/usr/bin/code-server",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.is_file() {
            return Ok(p);
        }
    }
    if let Ok(output) = Command::new("which").arg("code-server").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(PathBuf::from(path));
            }
        }
    }
    Err("code-server not found. Install it with: brew install code-server".into())
}

#[tauri::command]
fn check_code_server() -> Result<String, String> {
    resolve_code_server_bin().map(|p| p.to_string_lossy().to_string())
}

/// Blocks until the child is accepting TCP connections on `port`, or returns
/// an error if it exits first or takes too long. `spawn()` only proves the
/// process was started, not that code-server has finished booting and bound
/// its port — handing the port back before that lets the iframe hit a dead
/// port with no retry.
fn wait_until_ready(child: &mut Child, port: u16, timeout: Duration) -> Result<(), String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + timeout;
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("code-server exited immediately (status: {status})"));
        }
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("timed out waiting for code-server to start".into());
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

/// Shared data dir for every code-server instance — one level above the
/// `extensions` dir every project's process is pointed at, and where the
/// terminal helper's command file lives (see `terminal.rs`).
pub fn code_server_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("code-server"))
}

#[tauri::command]
fn start_project(
    app: tauri::AppHandle,
    registry: tauri::State<ServerRegistry>,
    id: String,
    path: String,
) -> Result<u16, String> {
    // Already running for this project: hand back its existing port instead
    // of spawning a second instance. Lock is held only for this check (and
    // again below to insert) so one project's startup wait can't block
    // another project's start_project call.
    if let Some(existing) = registry.0.lock().map_err(|e| e.to_string())?.get(&id) {
        return Ok(existing.port);
    }

    let bin = resolve_code_server_bin()?;
    let port = find_free_port()?;

    let data_dir = code_server_data_dir(&app)?;
    // Separate user-data-dir per project avoids workspaceStorage lock
    // conflicts between simultaneously running instances; extensions are
    // shared so they aren't reinstalled per project.
    let user_data_dir = data_dir.join("user-data").join(&id);
    let extensions_dir = data_dir.join("extensions");
    std::fs::create_dir_all(&user_data_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&extensions_dir).map_err(|e| e.to_string())?;

    // A server reads its extensions once, at startup — write this before
    // spawning so the process we're about to start actually picks it up.
    vscode_bridge::ensure_helper_extension(&extensions_dir);

    let mut child = Command::new(bin)
        .arg("--auth")
        .arg("none")
        .arg("--bind-addr")
        .arg(format!("127.0.0.1:{port}"))
        .arg("--disable-telemetry")
        .arg("--disable-update-check")
        .arg("--disable-workspace-trust")
        .arg("--user-data-dir")
        .arg(&user_data_dir)
        .arg("--extensions-dir")
        .arg(&extensions_dir)
        .arg(&path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to start code-server: {e}"))?;

    // Don't hand the port to the frontend until code-server is actually
    // listening on it — spawn() only proves the process started.
    wait_until_ready(&mut child, port, Duration::from_secs(20))?;

    registry
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, RunningServer { child, port });
    Ok(port)
}

#[tauri::command]
fn stop_project(registry: tauri::State<ServerRegistry>, id: String) -> Result<(), String> {
    let mut map = registry.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut server) = map.remove(&id) {
        let _ = server.child.kill();
        let _ = server.child.wait();
    }
    Ok(())
}

fn kill_all(registry: &ServerRegistry) {
    if let Ok(mut map) = registry.0.lock() {
        for (_, mut server) in map.drain() {
            let _ = server.child.kill();
            let _ = server.child.wait();
        }
    }
}

fn projects_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("projects.json"))
}

#[tauri::command]
fn load_projects(app: tauri::AppHandle) -> Result<Vec<Project>, String> {
    let file = projects_file(&app)?;
    if !file.exists() {
        return Ok(vec![]);
    }
    let data = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_projects(app: tauri::AppHandle, projects: Vec<Project>) -> Result<(), String> {
    let file = projects_file(&app)?;
    let data = serde_json::to_string_pretty(&projects).map_err(|e| e.to_string())?;
    std::fs::write(&file, data).map_err(|e| e.to_string())
}

const MAX_ICON_BYTES: u64 = 5 * 1024 * 1024;

/// Read a local image file and return it as a `data:` URL, for use as a
/// project icon. No resizing — project icons are small on disk in practice,
/// so this stays a plain read + base64 encode rather than pulling in an
/// image-decoding dependency.
#[tauri::command]
fn read_image_as_data_url(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("Could not read image: {e}"))?;
    if meta.len() > MAX_ICON_BYTES {
        return Err("Image is too large (max 5 MB).".to_string());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read image: {e}"))?;
    let mime = match std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        _ => "image/png",
    };
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ServerRegistry::default())
        .invoke_handler(tauri::generate_handler![
            check_code_server,
            start_project,
            stop_project,
            load_projects,
            save_projects,
            read_image_as_data_url,
            vscode_bridge::reveal_terminal,
            vscode_bridge::toggle_vscode_sidebar,
            vscode_bridge::set_vscode_theme,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Belt-and-suspenders cleanup: kill every spawned code-server
            // child no matter which quit path fired (Cmd+Q, window close,
            // ...), so nothing is left running after the app exits.
            if let tauri::RunEvent::Exit = event {
                if let Some(registry) = app_handle.try_state::<ServerRegistry>() {
                    kill_all(&registry);
                }
            }
        });
}
