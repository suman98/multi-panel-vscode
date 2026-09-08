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
  /** registered Claude account this project's VS Code runs as; unset means
      Claude Code's own keychain login */
  account_id?: string | null;
}

/** A registered Claude account. The token itself lives in the login keychain
    and never reaches the frontend — only this masked `hint` does. */
export interface Account {
  id: string;
  label: string;
  hint: string;
}

export type ProjectStatus = "idle" | "starting" | "running" | "error";

export type Theme = "dark" | "light";
