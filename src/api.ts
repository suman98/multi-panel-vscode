import { invoke } from "@tauri-apps/api/core";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import type { Project } from "./types";

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

/** Starts (or reuses) the code-server instance for a project, returning its port. */
export function startProject(id: string, path: string): Promise<number> {
  return invoke<number>("start_project", { id, path });
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

/** Native confirm dialog. */
export function confirmDialog(message: string, title?: string): Promise<boolean> {
  return confirm(message, { title, kind: "warning" });
}
