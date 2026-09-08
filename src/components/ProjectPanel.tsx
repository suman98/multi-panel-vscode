import type { Project, ProjectStatus } from "../types";

interface ProjectPanelProps {
  projects: Project[];
  selectedId: string | null;
  ports: Record<string, number>;
  statuses: Record<string, ProjectStatus>;
  errors: Record<string, string>;
  onRetry: (id: string) => void;
}

export default function ProjectPanel({
  projects,
  selectedId,
  ports,
  statuses,
  errors,
  onRetry,
}: ProjectPanelProps) {
  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return (
    <main className="panel">
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
    </main>
  );
}
