fn main() {
    // The UI is served over http://localhost in bundled builds (see lib.rs),
    // which the ACL treats as a *remote* origin. Commands defined by the app
    // are auto-allowed for local content only, so they have to be declared
    // here to get `allow-$command` permissions the capability can grant.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "check_code_server",
            "start_project",
            "stop_project",
            "load_projects",
            "save_projects",
            "read_image_as_data_url",
            "open_in_vscode",
            "reveal_terminal",
            "toggle_vscode_sidebar",
            "set_vscode_theme",
            "list_accounts",
            "add_account",
            "remove_account",
            "discover_shell_accounts",
            "adopt_shell_account",
        ])),
    )
    .expect("failed to run tauri build script")
}
