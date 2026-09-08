// A tiny local VS Code extension, installed into the shared extensions dir,
// that reveals the integrated terminal on request from the app. code-server
// runs each project as a separate process, but every process shares one
// extensions dir (see lib.rs) and one command file — the extension in every
// running project checks whether the command targets *its own* workspace
// folder before acting, so only the visible project's terminal responds.

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

static MANIFEST_LOCK: Mutex<()> = Mutex::new(());

const HELPER_ID: &str = "multivscodepanel.terminal-helper";
const HELPER_VERSION: &str = "1.0.0";
const HELPER_FOLDER: &str = "multivscodepanel.terminal-helper-1.0.0";
const COMMAND_FILE: &str = "mvp-terminal-cmd.json";

const PACKAGE_JSON: &str = r#"{
  "name": "terminal-helper",
  "displayName": "Multi VS Code Panel Terminal Helper",
  "description": "Reveals the integrated terminal on command from the host app.",
  "publisher": "multivscodepanel",
  "version": "1.0.0",
  "engines": { "vscode": "^1.90.0" },
  "main": "./extension.js",
  "activationEvents": ["onStartupFinished"],
  "extensionKind": ["workspace"],
  "capabilities": {
    "untrustedWorkspaces": { "supported": true },
    "virtualWorkspaces": true
  },
  "contributes": {}
}
"#;

const EXTENSION_JS: &str = r##"const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

// The app drops commands here; the extensions dir sits one level below the
// shared code-server data dir this file resolves against.
const COMMAND_FILE = path.resolve(__dirname, "..", "..", "mvp-terminal-cmd.json");

function myWorkspacePath() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders[0] ? folders[0].uri.fsPath : null;
}

function watchCommands(context) {
  let lastNonce = null;
  const tick = () => {
    let msg;
    try {
      msg = JSON.parse(fs.readFileSync(COMMAND_FILE, "utf8"));
    } catch (_) {
      return;
    }
    if (!msg || msg.nonce === lastNonce) return;
    // Skip whatever was already in the file when this window opened.
    const first = lastNonce === null;
    lastNonce = msg.nonce;
    if (first) return;
    if (msg.path && msg.path === myWorkspacePath()) {
      const term =
        vscode.window.activeTerminal || vscode.window.terminals[0] || vscode.window.createTerminal();
      term.show();
    }
  };
  tick();
  const timer = setInterval(tick, 400);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

function activate(context) {
  watchCommands(context);
}

module.exports = { activate, deactivate() {} };
"##;

fn entry_id(e: &serde_json::Value) -> Option<&str> {
    e.pointer("/identifier/id").and_then(|v| v.as_str())
}

fn read_manifest(ext_root: &Path) -> Option<Vec<serde_json::Value>> {
    let text = std::fs::read_to_string(ext_root.join("extensions.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// The server reads this manifest live, so never write it in place — a torn
/// write leaves half a document behind and the server then sees no extensions.
fn write_manifest(ext_root: &Path, entries: &[serde_json::Value]) {
    let Ok(text) = serde_json::to_string(entries) else {
        return;
    };
    let tmp = ext_root.join("extensions.json.mvp.tmp");
    if std::fs::write(&tmp, text).is_ok() && std::fs::rename(&tmp, ext_root.join("extensions.json")).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

/// A manifest that no longer parses is not ours to rewrite — move it aside so
/// code-server (or the next real install) can rebuild it, instead of clobbering
/// whatever extensions it already listed.
fn heal_corrupt_manifest(ext_root: &Path) {
    let path = ext_root.join("extensions.json");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return; // Missing is fine — an empty manifest is created below.
    };
    if serde_json::from_str::<Vec<serde_json::Value>>(&text).is_ok() {
        return;
    }
    eprintln!("[multi-vscode-panel] extensions.json does not parse — rebuilding it");
    let _ = std::fs::rename(&path, path.with_extension("json.corrupt"));
    let _ = std::fs::remove_file(&path);
}

/// Drop the helper extension into the shared extensions dir, idempotently.
/// Best-effort: a failure here should not stop a project from starting, it
/// just means the terminal button won't do anything for that session.
pub fn ensure_helper_extension(extensions_dir: &Path) {
    let _guard = MANIFEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    heal_corrupt_manifest(extensions_dir);
    let already = read_manifest(extensions_dir)
        .unwrap_or_default()
        .iter()
        .any(|e| entry_id(e) == Some(HELPER_ID));
    let dir = extensions_dir.join(HELPER_FOLDER);
    if already && dir.join("extension.js").is_file() {
        return;
    }

    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = std::fs::write(dir.join("package.json"), PACKAGE_JSON);
    let _ = std::fs::write(dir.join("extension.js"), EXTENSION_JS);

    // A manifest we still can't parse (e.g. concurrent write) is not ours to
    // rewrite — better to skip this launch's registration than to clobber it.
    let Some(mut entries) = read_manifest(extensions_dir).or_else(|| {
        if extensions_dir.join("extensions.json").exists() {
            None
        } else {
            Some(Vec::new())
        }
    }) else {
        return;
    };
    entries.retain(|e| entry_id(e) != Some(HELPER_ID));

    let fs_path = dir.to_string_lossy().to_string();
    entries.push(serde_json::json!({
        "identifier": { "id": HELPER_ID },
        "version": HELPER_VERSION,
        "location": {
            "$mid": 1,
            "fsPath": fs_path,
            "external": format!("file://{fs_path}"),
            "path": fs_path,
            "scheme": "file"
        },
        "relativeLocation": HELPER_FOLDER,
        "metadata": {
            "installedTimestamp": SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            "source": "vsix",
            "updated": false,
            "private": false,
            "isPreReleaseVersion": false,
            "hasPreReleaseVersion": false
        }
    }));
    write_manifest(extensions_dir, &entries);
}

fn nonce() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// `code-server`'s data dir is one level above its shared `extensions` dir —
/// see `code_server_data_dir` in lib.rs, which both this and `start_project`
/// derive their paths from.
#[tauri::command]
pub fn reveal_terminal(app: AppHandle, path: String) -> Result<(), String> {
    let data_dir = crate::code_server_data_dir(&app)?;
    let payload = serde_json::json!({ "nonce": nonce(), "path": path });
    std::fs::write(
        data_dir.join(COMMAND_FILE),
        serde_json::to_string(&payload).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
