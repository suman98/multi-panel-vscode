export interface Project {
  id: string;
  name: string;
  path: string;
}

export type ProjectStatus = "idle" | "starting" | "running" | "error";
