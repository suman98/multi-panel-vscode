import { invoke } from "@tauri-apps/api/core";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import type { Account, Project } from "./types";

/** Resolves the code-server binary path, or throws with install instructions. */
export function checkCodeServer(): Promise<string> {
  return invoke<string>("check_code_server");
}

export function loadProjects(): Promise<Project[]> {
  return invoke<Project[]>("load_projects");
}

export function saveProjects(projects: Project[]): Promise<void> {
  return invoke<void>("save_projects", { projects });
}

/** Starts (or reuses) the code-server instance for a project, returning its
    port. The account is read at spawn time, so switching one takes effect only
    after a restart. */
export function startProject(
  id: string,
  path: string,
  accountId?: string | null,
): Promise<number> {
  return invoke<number>("start_project", { id, path, accountId: accountId ?? null });
}

export function stopProject(id: string): Promise<void> {
  return invoke<void>("stop_project", { id });
}

/** Opens the native folder picker. Returns null if the user cancels. */
export async function pickFolder(): Promise<string | null> {
  const result = await open({
    directory: true,
    multiple: false,
    title: "Choose a project folder",
  });
  return typeof result === "string" ? result : null;
}

/** Opens the native image picker, for a project icon. Returns null if cancelled. */
export async function pickImage(): Promise<string | null> {
  const result = await open({
    directory: false,
    multiple: false,
    title: "Choose a project icon",
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
  });
  return typeof result === "string" ? result : null;
}

/** Reads a local image file into a `data:` URL suitable for storing as a project icon. */
export function readImageAsDataUrl(path: string): Promise<string> {
  return invoke<string>("read_image_as_data_url", { path });
}

/** Asks the running project's embedded VS Code to reveal its integrated terminal. */
export function revealTerminal(path: string): Promise<void> {
  return invoke<void>("reveal_terminal", { path });
}

/** Asks the running project's embedded VS Code to toggle its own Explorer/primary sidebar. */
export function toggleVscodeSidebar(path: string): Promise<void> {
  return invoke<void>("toggle_vscode_sidebar", { path });
}

/** Keeps every embedded VS Code's own colour theme in step with the app's. */
export function setVscodeTheme(theme: "dark" | "light"): Promise<string> {
  return invoke<string>("set_vscode_theme", { theme });
}

/** Native confirm dialog. */
export function confirmDialog(message: string, title?: string): Promise<boolean> {
  return confirm(message, { title, kind: "warning" });
}

/** Opens the project in a new VS Code window using the `code` shell command. */
export function openInVscode(path: string): Promise<void> {
  return invoke<void>("open_in_vscode", { path });
}

/** Registered Claude accounts (labels and masked hints only). */
export function listAccounts(): Promise<Account[]> {
  return invoke<Account[]>("list_accounts");
}

/** Stores a token in the login keychain and registers it. Returns the new list. */
export function addAccount(label: string, token: string): Promise<Account[]> {
  return invoke<Account[]>("add_account", { label, token });
}

/** Forgets an account and its keychain token. */
export function removeAccount(id: string): Promise<Account[]> {
  return invoke<Account[]>("remove_account", { id });
}

/** Labels of `CLAUDE_CODE_OAUTH_TOKEN` values found in the user's shell profiles. */
export function discoverShellAccounts(): Promise<string[]> {
  return invoke<string[]>("discover_shell_accounts");
}

/** Registers one of the discovered shell tokens under a name of your choosing. */
export function adoptShellAccount(label: string, name: string): Promise<Account[]> {
  return invoke<Account[]>("adopt_shell_account", { label, name });
}
