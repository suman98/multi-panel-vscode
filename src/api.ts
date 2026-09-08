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

/** Native confirm dialog. */
export function confirmDialog(message: string, title?: string): Promise<boolean> {
  return confirm(message, { title, kind: "warning" });
}
