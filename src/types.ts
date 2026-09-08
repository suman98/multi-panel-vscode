export interface Project {
  id: string;
  name: string;
  path: string;
  favorite?: boolean;
  /** hex accent colour chosen by the user, e.g. "#f38ec4" */
  color?: string | null;
  /** custom icon as a `data:image/png;base64,…` URL */
  icon?: string | null;
  /** ms epoch of the last time this project was selected */
  last_opened?: number | null;
}

export type ProjectStatus = "idle" | "starting" | "running" | "error";

export type Theme = "dark" | "light";
