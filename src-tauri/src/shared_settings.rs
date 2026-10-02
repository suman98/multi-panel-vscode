// Every project runs its own code-server process with its own
// `--user-data-dir` (see `start_project`), because two instances can't share
// one `globalStorage`/`workspaceStorage` without fighting over SQLite locks.
// The side effect was that the *editable* half of that directory —
// settings.json, keybindings.json, snippets — was per-project too, so every
// project drifted into its own theme, font size and icon theme.
//
// code-server has no flag to point those files somewhere else, so each
// project's `User/<entry>` is replaced with a symlink into one shared
// `user-config` dir. That keeps the storage dirs private (no lock contention)
// while the preferences are literally the same file everywhere.
//
// Symlinks specifically, not copies: VS Code writes settings.json in place
// when the path is a symlink (it skips its usual write-to-temp-then-rename
// because that would replace the link with a regular file), so an edit made
// in any project lands in the shared file and every other project sees it.

use std::path::{Path, PathBuf};

/// Entries under `<user-data-dir>/User` that hold user preferences rather
/// than per-instance state. `snippets` is a directory, the rest are files.
const SHARED_ENTRIES: [&str; 4] = ["settings.json", "keybindings.json", "snippets", "tasks.json"];

/// Seeded so the symlink never dangles on a fresh install; `tasks.json` is
/// deliberately absent — an empty user tasks file makes VS Code offer a task
/// list that isn't there, so it's only linked once something creates it.
const SEEDS: [(&str, &str); 2] = [("settings.json", "{}\n"), ("keybindings.json", "[]\n")];

/// The one directory every project's preferences actually live in.
pub fn shared_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("user-config")
}

fn backup_dir(data_dir: &Path, id: &str) -> PathBuf {
    data_dir.join("user-config-backup").join(id)
}

#[cfg(unix)]
fn symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    if target.is_dir() {
        std::os::windows::fs::symlink_dir(target, link)
    } else {
        std::os::windows::fs::symlink_file(target, link)
    }
}

/// Fold every project's existing settings.json into one shared file, newest
/// last so a key set in the most recently touched project wins. Runs once —
/// as soon as the shared file exists this does nothing, and from then on the
/// projects are all writing that same file anyway.
///
/// Merged rather than "pick one": these files accumulated independently, so
/// choosing a single winner would silently drop whatever the user had only
/// ever set in some other project.
fn seed_from_existing(data_dir: &Path, shared: &Path) {
    let target = shared.join("settings.json");
    if target.exists() {
        return;
    }

    let mut found: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(data_dir.join("user-data")) {
        for e in entries.flatten() {
            let path = e.path().join("User").join("settings.json");
            // Skip anything already linked — only real files are sources.
            if !path.symlink_metadata().map(|m| m.is_file()).unwrap_or(false) {
                continue;
            }
            if let Ok(mtime) = path.metadata().and_then(|m| m.modified()) {
                found.push((mtime, path));
            }
        }
    }
    if found.is_empty() {
        return;
    }
    found.sort_by(|a, b| a.0.cmp(&b.0));

    let mut merged = serde_json::Map::new();
    for (_, path) in &found {
        let Ok(text) = std::fs::read_to_string(path) else {
            continue;
        };
        // A file that doesn't parse (hand-written comments, torn write) is
        // skipped rather than guessed at; its backup is still kept below.
        if let Ok(serde_json::Value::Object(map)) = serde_json::from_str(&text) {
            for (k, v) in map {
                merged.insert(k, v);
            }
        }
    }
    if merged.is_empty() {
        return;
    }
    if let Ok(text) = serde_json::to_string_pretty(&serde_json::Value::Object(merged)) {
        let _ = std::fs::write(&target, format!("{text}\n"));
        eprintln!(
            "[multi-vscode-panel] merged {} per-project settings.json into {}",
            found.len(),
            target.display()
        );
    }
}

/// Move a project's own copy aside before the symlink replaces it, so the
/// merge above is never the only record of what it used to contain. Returns
/// whether `from` is now safe to remove — a backup that couldn't be written
/// means the caller must leave the project's file alone.
fn back_up(data_dir: &Path, id: &str, name: &str, from: &Path) -> bool {
    let dest_dir = backup_dir(data_dir, id);
    let dest = dest_dir.join(name);
    if dest.exists() {
        return true; // Kept from an earlier run; don't overwrite it.
    }
    if std::fs::create_dir_all(&dest_dir).is_err() {
        return false;
    }
    // A rename keeps directories (snippets) intact and can't half-copy.
    std::fs::rename(from, &dest).is_ok()
}

fn link_entry(data_dir: &Path, shared: &Path, user_dir: &Path, id: &str, name: &str) {
    let link = user_dir.join(name);
    let target = shared.join(name);

    if std::fs::read_link(&link).map(|t| t == target).unwrap_or(false) {
        return; // Already ours.
    }
    match link.symlink_metadata() {
        // A real file or directory from before sharing: preserve it, then
        // take over the path.
        Ok(meta) if !meta.is_symlink() => {
            if !back_up(data_dir, id, name, &link) {
                // Couldn't stash it — better to leave this project on its own
                // preferences than to delete the only copy of them.
                eprintln!("[multi-vscode-panel] could not back up {name} for {id}; leaving it unshared");
                return;
            }
            if link.exists() {
                let _ = if meta.is_dir() {
                    std::fs::remove_dir_all(&link)
                } else {
                    std::fs::remove_file(&link)
                };
            }
        }
        // A symlink pointing somewhere else (older layout): just drop it.
        Ok(_) => {
            let _ = std::fs::remove_file(&link);
        }
        Err(_) => {}
    }
    if !target.exists() {
        return; // Nothing to point at yet (e.g. tasks.json).
    }
    if let Err(e) = symlink(&target, &link) {
        // Best-effort: on a platform or filesystem without symlinks the
        // project still starts, it just keeps its own preferences.
        eprintln!("[multi-vscode-panel] could not share {name}: {e}");
    }
}

/// Point one project's `User` preferences at the shared copy. Called before
/// the project's code-server is spawned, since it reads these at startup.
pub fn ensure_shared(data_dir: &Path, user_data_dir: &Path, id: &str) {
    let shared = shared_dir(data_dir);
    if std::fs::create_dir_all(shared.join("snippets")).is_err() {
        return;
    }
    seed_from_existing(data_dir, &shared);
    for (name, default) in SEEDS {
        let path = shared.join(name);
        if !path.exists() {
            let _ = std::fs::write(path, default);
        }
    }

    let user_dir = user_data_dir.join("User");
    if std::fs::create_dir_all(&user_dir).is_err() {
        return;
    }
    for name in SHARED_ENTRIES {
        link_entry(data_dir, &shared, &user_dir, id, name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn project(data_dir: &Path, id: &str) -> PathBuf {
        data_dir.join("user-data").join(id)
    }

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mvp-shared-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // Two projects that drifted apart end up on one file, and the newer
    // project wins the key they disagree on without dropping the key only the
    // older one ever set.
    #[test]
    fn merges_every_project_newest_key_wins() {
        let data = tmp("merge");
        let old = project(&data, "old");
        let new = project(&data, "new");
        write(
            &old.join("User/settings.json"),
            r#"{"workbench.colorTheme":"Default Light Modern","editor.minimap.enabled":false}"#,
        );
        write(
            &new.join("User/settings.json"),
            r#"{"workbench.colorTheme":"Default Dark Modern"}"#,
        );
        // mtime, not directory order, decides.
        filetime::set_file_mtime(
            old.join("User/settings.json"),
            filetime::FileTime::from_unix_time(1_000, 0),
        )
        .unwrap();
        filetime::set_file_mtime(
            new.join("User/settings.json"),
            filetime::FileTime::from_unix_time(2_000, 0),
        )
        .unwrap();

        ensure_shared(&data, &old, "old");
        ensure_shared(&data, &new, "new");

        let merged: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(shared_dir(&data).join("settings.json")).unwrap())
                .unwrap();
        assert_eq!(merged["workbench.colorTheme"], "Default Dark Modern");
        assert_eq!(merged["editor.minimap.enabled"], false);

        // Both projects now read and write that one file.
        for id in ["old", "new"] {
            let link = project(&data, id).join("User/settings.json");
            assert!(link.symlink_metadata().unwrap().is_symlink(), "{id} not linked");
            assert_eq!(std::fs::read_link(&link).unwrap(), shared_dir(&data).join("settings.json"));
        }
        // …and what each one used to hold is still recoverable.
        assert!(data.join("user-config-backup/old/settings.json").is_file());

        let _ = std::fs::remove_dir_all(&data);
    }

    // An edit written through one project's path is what every other project
    // reads — the point of the whole exercise.
    #[test]
    fn write_through_one_project_is_visible_from_another() {
        let data = tmp("shared");
        let a = project(&data, "a");
        let b = project(&data, "b");
        ensure_shared(&data, &a, "a");
        ensure_shared(&data, &b, "b");

        std::fs::write(a.join("User/settings.json"), r#"{"editor.fontSize":18}"#).unwrap();
        assert_eq!(
            std::fs::read_to_string(b.join("User/settings.json")).unwrap(),
            r#"{"editor.fontSize":18}"#
        );
        // Writing through the link must not have replaced it with a real file.
        assert!(a.join("User/settings.json").symlink_metadata().unwrap().is_symlink());

        let _ = std::fs::remove_dir_all(&data);
    }

    // Starting a project twice must not re-link, re-seed, or lose the backup.
    #[test]
    fn is_idempotent_across_restarts() {
        let data = tmp("idem");
        let p = project(&data, "p");
        write(&p.join("User/settings.json"), r#"{"editor.fontSize":13}"#);

        ensure_shared(&data, &p, "p");
        std::fs::write(p.join("User/settings.json"), r#"{"editor.fontSize":20}"#).unwrap();
        ensure_shared(&data, &p, "p");

        assert_eq!(
            std::fs::read_to_string(shared_dir(&data).join("settings.json")).unwrap(),
            r#"{"editor.fontSize":20}"#
        );
        assert_eq!(
            std::fs::read_to_string(data.join("user-config-backup/p/settings.json")).unwrap(),
            r#"{"editor.fontSize":13}"#
        );

        let _ = std::fs::remove_dir_all(&data);
    }

    // snippets is a directory, and tasks.json usually doesn't exist at all.
    #[test]
    fn links_snippets_dir_and_skips_absent_tasks() {
        let data = tmp("entries");
        let p = project(&data, "p");
        write(&p.join("User/snippets/rust.json"), "{}");

        ensure_shared(&data, &p, "p");

        let snippets = p.join("User/snippets");
        assert!(snippets.symlink_metadata().unwrap().is_symlink());
        // The project's own snippets were preserved, not deleted.
        assert!(data.join("user-config-backup/p/snippets/rust.json").is_file());
        assert!(!p.join("User/tasks.json").symlink_metadata().is_ok());

        let _ = std::fs::remove_dir_all(&data);
    }
}
