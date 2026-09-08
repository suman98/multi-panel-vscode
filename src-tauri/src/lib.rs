mod vscode_bridge;

use std::collections::HashMap;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

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

/// Resolve the VS Code CLI binary path. Checks common install locations and PATH.
fn resolve_vscode_bin() -> Result<PathBuf, String> {
    let candidates = [
        "/usr/local/bin/code",           // Common symlink location
        "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code", // Direct app path
        "/opt/homebrew/bin/code",        // Apple Silicon Homebrew
    ];
    
    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Ok(p);
        }
    }
    
    // Try to find it in PATH using `which`
    if let Ok(output) = Command::new("which").arg("code").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(PathBuf::from(path));
            }
        }
    }
    
    Err("VS Code CLI not found. Install it via VS Code: ⇧⌘P → 'Shell Command: Install code command in PATH'".into())
}

/// Opens the project in a new VS Code window using the `code` command.
#[tauri::command]
fn open_in_vscode(path: String) -> Result<(), String> {
    let bin = resolve_vscode_bin()?;
    Command::new(bin)
        .arg(&path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to open VS Code: {e}"))?;
    Ok(())
}

/// The UI's origin is `http://localhost:<port>`, and the frontend keeps
/// preferences (theme, sidebar width) in localStorage — which is keyed by
/// origin. A port that changed every launch would silently reset them, so
/// walk a fixed range in order and only fall back to an arbitrary free port
/// if every one of them is taken.
///
/// Probes "localhost" rather than 127.0.0.1 because that is what the server
/// itself binds, and the two don't always resolve to the same address family
/// — handing over a port that's free on IPv4 but taken on IPv6 would leave
/// the server unable to start.
fn pick_ui_port() -> Option<u16> {
    let free = |port: u16| TcpListener::bind(("localhost", port)).is_ok();
    (41420..41440).find(|port| free(*port)).or_else(|| {
        let ephemeral = TcpListener::bind(("localhost", 0)).ok()?;
        ephemeral.local_addr().ok().map(|addr| addr.port())
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    // A bundled build normally serves the UI from the `tauri://localhost`
    // custom scheme. WebKit won't run VS Code's webviews — the panels
    // extensions like Claude Code render into — inside a page that came from
    // a custom scheme, so they come up permanently blank. Serving our own UI
    // over http://localhost instead makes a bundled build behave like `tauri
    // dev` (which is served by Vite over http), and the webviews work.
    let ui_port = if tauri::is_dev() { None } else { pick_ui_port() };
    if let Some(port) = ui_port {
        builder = builder.plugin(tauri_plugin_localhost::Builder::new(port).build());
    }

    builder
        .manage(ServerRegistry::default())
        .invoke_handler(tauri::generate_handler![
            check_code_server,
            start_project,
            stop_project,
            load_projects,
            save_projects,
            read_image_as_data_url,
            open_in_vscode,
            vscode_bridge::reveal_terminal,
            vscode_bridge::toggle_vscode_sidebar,
            vscode_bridge::set_vscode_theme,
        ])
        .setup(move |app| {
            // The window is built here rather than in tauri.conf.json because
            // its URL depends on whether we're serving over http (above).
            let url = match ui_port {
                Some(port) => WebviewUrl::External(
                    format!("http://localhost:{port}")
                        .parse()
                        .expect("localhost url is valid"),
                ),
                // Dev (Vite's http dev server), or the unlikely case that no
                // port was free — the app still runs, webviews included in
                // dev; a bundled fallback loses only the webviews.
                None => WebviewUrl::default(),
            };
            WebviewWindowBuilder::new(app, "main", url)
                .title("Multi VS Code Panel")
                .inner_size(1280.0, 800.0)
                .min_inner_size(800.0, 500.0)
                .build()?;
            Ok(())
        })
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
