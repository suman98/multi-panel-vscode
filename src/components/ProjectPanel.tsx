import type { CSSProperties } from "react";
import type { Project, ProjectStatus } from "../types";

interface ProjectPanelProps {
  projects: Project[];
  selectedId: string | null;
  ports: Record<string, number>;
  statuses: Record<string, ProjectStatus>;
  errors: Record<string, string>;
  onRetry: (id: string) => void;
  onShowTerminal: (path: string) => void;
}

export default function ProjectPanel({
  projects,
  selectedId,
  ports,
  statuses,
  errors,
  onRetry,
  onShowTerminal,
}: ProjectPanelProps) {
  const selected = projects.find((p) => p.id === selectedId) ?? null;
  const selectedRunning = !!selected && !!ports[selected.id];

  return (
    <main className="panel">
      {selected && (
        <header
          className={"panel-head" + (selected.color ? " tinted" : "")}
          style={selected.color ? ({ "--proj-color": selected.color } as CSSProperties) : undefined}
        >
          <span className="panel-head-name">{selected.name}</span>
          <span className="panel-head-path">{selected.path}</span>
          <button
            className="terminal-btn"
            onClick={() => onShowTerminal(selected.path)}
            disabled={!selectedRunning}
            title="Open the integrated terminal"
          >
            Terminal
          </button>
        </header>
      )}

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
