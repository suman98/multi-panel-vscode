import type { CSSProperties } from "react";
import type { Project, ProjectStatus, Theme } from "../types";

/** VS Code's own Explorer sidebar — distinct from the app's own ☰ (its
    project list), a narrower left strip mirroring VS Code's own glyph. */
function VscodeSidebarIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 2.8v10.4" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2.4" y="3.4" width="2" height="9.2" rx="0.8" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

interface ProjectPanelProps {
  projects: Project[];
  selectedId: string | null;
  ports: Record<string, number>;
  statuses: Record<string, ProjectStatus>;
  errors: Record<string, string>;
  onRetry: (id: string) => void;
  onShowTerminal: (path: string) => void;
  /** best-effort — a locally-tracked guess, since VS Code doesn't report its
      own sidebar's open state back to us */
  vscodeSidebarOpen: Record<string, boolean>;
  onToggleVscodeSidebar: (id: string, path: string) => void;
  showSidebar: boolean;
  onToggleSidebar: () => void;
  onAdd: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export default function ProjectPanel({
  projects,
  selectedId,
  ports,
  statuses,
  errors,
  onRetry,
  onShowTerminal,
  vscodeSidebarOpen,
  onToggleVscodeSidebar,
  showSidebar,
  onToggleSidebar,
  onAdd,
  theme,
  onToggleTheme,
}: ProjectPanelProps) {
  const selected = projects.find((p) => p.id === selectedId) ?? null;
  const selectedRunning = !!selected && !!ports[selected.id];
  const selectedSidebarOpen = selected ? (vscodeSidebarOpen[selected.id] ?? true) : true;

  return (
    <main className="panel">
      <header
        className={"panel-head" + (selected?.color ? " tinted" : "")}
        style={selected?.color ? ({ "--proj-color": selected.color } as CSSProperties) : undefined}
      >
        <button
          className={"icon-btn" + (showSidebar ? " on" : "")}
          onClick={onToggleSidebar}
          title={showSidebar ? "Collapse sidebar" : "Show sidebar"}
          aria-pressed={showSidebar}
        >
          ☰
        </button>
        {/* The sidebar's own + button disappears when it's collapsed, so give
            it a way back here instead of stranding the user. */}
        {!showSidebar && (
          <button className="icon-btn" onClick={onAdd} title="Add project folder">
            +
          </button>
        )}

        {selected && (
          <>
            <span className="panel-head-name">{selected.name}</span>
            <span className="panel-head-path">{selected.path}</span>
          </>
        )}

        <div className="panel-head-actions">
          {selected && (
            <button
              className={"icon-btn" + (selectedSidebarOpen ? " on" : "")}
              onClick={() => onToggleVscodeSidebar(selected.id, selected.path)}
              disabled={!selectedRunning}
              title="Toggle VS Code's sidebar"
              aria-pressed={selectedSidebarOpen}
            >
              <VscodeSidebarIcon />
            </button>
          )}
          {selected && (
            <button
              className="terminal-btn"
              onClick={() => onShowTerminal(selected.path)}
              disabled={!selectedRunning}
              title="Open the integrated terminal"
            >
              Terminal
            </button>
          )}
          <button
            className="icon-btn"
            onClick={onToggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? "☀" : "🌙"}
          </button>
        </div>
      </header>

      <div className="panel-body">
        {/* Every project that has ever been started keeps its iframe mounted
            (just hidden) so switching projects doesn't reload/lose VS Code
            state — open tabs, terminals, unsaved edits. */}
        {projects.map((p) => {
          const port = ports[p.id];
          if (!port) return null;
          const isSelected = p.id === selectedId;
          return (
            <iframe
              key={p.id}
              title={p.name}
              src={`http://127.0.0.1:${port}/?folder=${encodeURIComponent(p.path)}`}
              className="vscode-frame"
              hidden={!isSelected}
            />
          );
        })}

        {!selected && (
          <div className="panel-empty">
            <p>Select a project, or click + to add one.</p>
          </div>
        )}

        {selected && !ports[selected.id] && (
          <div className="panel-empty">
            {statuses[selected.id] === "error" ? (
              <>
                <p className="panel-error">{errors[selected.id] ?? "Failed to start."}</p>
                <button className="retry-btn" onClick={() => onRetry(selected.id)}>
                  Retry
                </button>
              </>
            ) : (
              <p>Starting VS Code for {selected.name}…</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
