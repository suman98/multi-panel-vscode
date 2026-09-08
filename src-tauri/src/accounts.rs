// Claude account switching, per project.
//
// Claude Code takes its identity from `CLAUDE_CODE_OAUTH_TOKEN` when that is
// set, and otherwise from its keychain login. Each project here runs its own
// code-server process, so each one can be spawned with a different token —
// two panels side by side, signed in as two different accounts.
//
// Tokens live in the login keychain under `multi-vscode-panel-oauth`, never in
// `accounts.json` and never handed to the frontend; the store and the UI only
// ever see a label and a masked hint.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

pub const KEYCHAIN_SERVICE: &str = "multi-vscode-panel-oauth";

/// A registered token. Claude Code's own keychain login is not an entry here —
/// that is what a project's `account_id` being `None` means.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Account {
    /// stable key, also the keychain account name
    pub id: String,
    pub label: String,
    /// first/last few characters, for confirming which token this is
    #[serde(default)]
    pub hint: String,
}

fn masked(token: &str) -> String {
    let n = token.chars().count();
    if n <= 12 {
        return "•".repeat(n.min(8));
    }
    let head: String = token.chars().take(8).collect();
    let tail: String = token.chars().skip(n - 4).collect();
    format!("{head}…{tail}")
}

pub fn hint_for(token: &str) -> String {
    masked(token)
}

pub fn store_token(id: &str, token: &str) -> Result<String, String> {
    // -U updates in place when the entry already exists.
    let out = Command::new("security")
        .args([
            "add-generic-password",
            "-U",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            id,
            "-w",
            token,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("keychain write failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "keychain write failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(masked(token))
}

pub fn read_token(id: &str) -> Option<String> {
    let out = Command::new("security")
        .args(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", id, "-w"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let token = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!token.is_empty()).then_some(token)
}

pub fn forget_token(id: &str) {
    let _ = Command::new("security")
        .args(["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", id])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// Tokens already exported in the user's shell profile, offered as a starting
/// point so they need not be pasted by hand. Values never leave the backend.
pub fn scan_shell_profiles() -> Vec<(String, String)> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return Vec::new();
    };
    let mut found: Vec<(String, String)> = Vec::new();
    for file in [".zshrc", ".bashrc", ".zprofile", ".profile", ".zshenv"] {
        let Ok(text) = std::fs::read_to_string(home.join(file)) else {
            continue;
        };
        for line in text.lines() {
            let line = line.trim();
            if line.starts_with('#') || !line.contains("CLAUDE_CODE_OAUTH_TOKEN") {
                continue;
            }
            let Some((_, rhs)) = line.split_once("CLAUDE_CODE_OAUTH_TOKEN=") else {
                continue;
            };
            let token = rhs
                .trim()
                .trim_matches(|c| c == '"' || c == '\'')
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_string();
            if token.starts_with("sk-ant-") && !found.iter().any(|(_, t)| *t == token) {
                found.push((format!("{file} · {}", masked(&token)), token));
            }
        }
    }
    found
}

/// The account list — labels and hints only. Tokens are in the keychain.
pub fn accounts_file(dir: &Path) -> PathBuf {
    dir.join("accounts.json")
}

pub fn load(dir: &Path) -> Vec<Account> {
    std::fs::read_to_string(accounts_file(dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(dir: &Path, accounts: &[Account]) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(accounts).map_err(|e| e.to_string())?;
    std::fs::write(accounts_file(dir), text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_all_but_the_ends() {
        let m = masked("sk-ant-oat01-abcdefghijklmnop");
        assert!(m.starts_with("sk-ant-o"));
        assert!(m.ends_with("mnop"));
        assert!(!m.contains("abcdefghij"));
    }

    #[test]
    fn short_secrets_are_fully_hidden() {
        assert_eq!(masked("abc"), "•••");
    }
}
