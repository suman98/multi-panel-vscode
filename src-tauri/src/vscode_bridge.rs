// A tiny local VS Code extension, installed into the shared extensions dir,
// that lets the app reach into each embedded VS Code: reveal its terminal,
// and keep its colour theme in step with the app's own. code-server runs
// each project as a separate process, but every process shares one
// extensions dir (see lib.rs) and one command file.
//
// "revealTerminal" is targeted — the extension only acts if the command's
// `path` matches its own workspace folder, so only the visible project's
// terminal responds. "setTheme" is broadcast — every running project applies
// it, so a project that's merely hidden (not the active one) still matches
// the app's theme by the time it's switched to.

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::AppHandle;

static MANIFEST_LOCK: Mutex<()> = Mutex::new(());

const HELPER_ID: &str = "multivscodepanel.vscode-bridge";
const HELPER_VERSION: &str = "1.1.0";
const HELPER_FOLDER: &str = "multivscodepanel.vscode-bridge-1.1.0";
const COMMAND_FILE: &str = "mvp-cmd.json";
/// Persisted separately from the command file so a project started long after
/// the last theme toggle still comes up matching, instead of always booting
/// dark until the next toggle happens to fire.
const THEME_FILE: &str = "mvp-theme.json";

const PACKAGE_JSON: &str = r#"{
  "name": "vscode-bridge",
  "displayName": "Multi VS Code Panel Bridge",
  "description": "Reveals the terminal and syncs the colour theme on command from the host app.",
  "publisher": "multivscodepanel",
  "version": "1.1.0",
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

// The app drops commands here; both files sit one level below the shared
// extensions dir this file resolves against.
const COMMAND_FILE = path.resolve(__dirname, "..", "..", "mvp-cmd.json");
const THEME_FILE = path.resolve(__dirname, "..", "..", "mvp-theme.json");

function myWorkspacePath() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders[0] ? folders[0].uri.fsPath : null;
}

const THEMES = {
  dark: "Default Dark Modern",
  light: "Default Light Modern",
};

// A softer, blue-tinted take on Default Light Modern, scoped to that theme so
// switching back to dark leaves the stock palette untouched.
const LIGHT_CUSTOMIZATIONS = {
  "[Default Light Modern]": {
    "editor.background": "#EBF6FF",
    "editor.foreground": "#102030",

    "editorLineNumber.foreground": "#7F9AAF",
    "editorCursor.foreground": "#000000",
    "editor.selectionBackground": "#B9E0FF",
    "editor.inactiveSelectionBackground": "#D7ECFC",
    "editor.lineHighlightBackground": "#DFF1FF",
    "editorWhitespace.foreground": "#B4CDDF",

    "tab.activeBackground": "#FFFFFF",
    "tab.activeForeground": "#102030",
    "tab.inactiveBackground": "#D7ECFC",
    "tab.inactiveForeground": "#5E7688",
    "tab.border": "#C2D9EA",

    "sideBar.background": "#E1F1FD",
    "sideBar.foreground": "#102030",
    "sideBarSectionHeader.background": "#D2E8F8",
    "sideBarSectionHeader.foreground": "#102030",

    "activityBar.background": "#D2E8F8",
    "activityBar.foreground": "#0B1F33",
    "activityBar.inactiveForeground": "#6D879A",
    "activityBarBadge.background": "#007ACC",
    "activityBarBadge.foreground": "#FFFFFF",

    "titleBar.activeBackground": "#E1F1FD",
    "titleBar.activeForeground": "#102030",
    "titleBar.inactiveBackground": "#F3FAFF",
    "titleBar.inactiveForeground": "#6D879A",

    "statusBar.background": "#D2E8F8",
    "statusBar.foreground": "#102030",
    "statusBar.noFolderBackground": "#D2E8F8",
    "statusBar.debuggingBackground": "#FFD966",
    "statusBar.debuggingForeground": "#000000",

    "panel.background": "#F5FBFF",
    "panel.border": "#C2D9EA",

    "terminal.background": "#EBF6FF",
    "terminal.foreground": "#102030",
    "terminalCursor.foreground": "#000000",
  },
};

async function applySettings(map) {
  const cfg = vscode.workspace.getConfiguration();
  for (const key of Object.keys(map)) {
    const want = map[key];
    let current;
    try {
      current = cfg.inspect(key);
    } catch (_) {
      current = undefined;
    }
    // Object values (colour customizations) never compare equal by identity.
    if (current && JSON.stringify(current.globalValue) === JSON.stringify(want)) continue;
    try {
      await cfg.update(key, want, vscode.ConfigurationTarget.Global);
    } catch (_) {}
  }
}

async function applyTheme(theme) {
  const light = theme === "light";
  await applySettings({
    "workbench.colorTheme": THEMES[light ? "light" : "dark"],
    "workbench.colorCustomizations": light ? LIGHT_CUSTOMIZATIONS : {},
  });
}

function readTheme() {
  try {
    const raw = JSON.parse(fs.readFileSync(THEME_FILE, "utf8"));
    return raw && raw.theme === "light" ? "light" : "dark";
  } catch (_) {
    return "dark";
  }
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

    if (msg.command === "revealTerminal") {
      if (msg.path && msg.path === myWorkspacePath()) {
        const term =
          vscode.window.activeTerminal || vscode.window.terminals[0] || vscode.window.createTerminal();
        term.show();
      }
    } else if (msg.command === "setTheme") {
      applyTheme(msg.theme === "light" ? "light" : "dark");
    }
  };
  tick();
  const timer = setInterval(tick, 400);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

async function activate(context) {
  // Match whatever the app's theme already was before this window opened —
  // otherwise a project started well after the last toggle boots dark and
  // only catches up on the next one.
  await applyTheme(readTheme());
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
/// just means the terminal/theme bridge won't do anything for that session.
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

    // Drop any older copy of the extension (including the earlier
    // terminal-only build) so the server doesn't keep stale versions around.
    if let Ok(entries) = std::fs::read_dir(extensions_dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with("multivscodepanel.") && name != HELPER_FOLDER {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }

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
    // Also drop any manifest entry left over from the old terminal-only id.
    entries.retain(|e| {
        !matches!(entry_id(e), Some(id) if id == HELPER_ID || id == "multivscodepanel.terminal-helper")
    });

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

fn push_command(data_dir: &Path, payload: serde_json::Value) -> Result<(), String> {
    std::fs::write(
        data_dir.join(COMMAND_FILE),
        serde_json::to_string(&payload).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Ask the running project's embedded VS Code to reveal its integrated
/// terminal — only the instance whose workspace matches `path` acts.
#[tauri::command]
pub fn reveal_terminal(app: AppHandle, path: String) -> Result<(), String> {
    let data_dir = crate::code_server_data_dir(&app)?;
    push_command(
        &data_dir,
        serde_json::json!({ "nonce": nonce(), "command": "revealTerminal", "path": path }),
    )
}

/// Keep every running project's colour theme in step with the app's. Written
/// to disk as well as pushed, so a project started later reads this instead
/// of booting dark and waiting to be told.
#[tauri::command]
pub fn set_vscode_theme(app: AppHandle, theme: String) -> Result<String, String> {
    let theme = if theme == "light" { "light" } else { "dark" };
    let data_dir = crate::code_server_data_dir(&app)?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    std::fs::write(
        data_dir.join(THEME_FILE),
        serde_json::to_string(&serde_json::json!({ "theme": theme })).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    push_command(
        &data_dir,
        serde_json::json!({ "nonce": nonce(), "command": "setTheme", "theme": theme }),
    )?;
    Ok(theme.to_string())
}
