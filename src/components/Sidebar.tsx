import type { Project, ProjectStatus } from "../types";

interface SidebarProps {
  projects: Project[];
  selectedId: string | null;
  statuses: Record<string, ProjectStatus>;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  codeServerReady: boolean;
}

const statusColor: Record<ProjectStatus, string> = {
  idle: "#6e6e6e",
  starting: "#d9a940",
  running: "#3fb950",
  error: "#f14c4c",
};

const statusTitle: Record<ProjectStatus, string> = {
  idle: "Not started",
  starting: "Starting VS Code…",
  running: "Running",
  error: "Failed to start",
};

export default function Sidebar({
  projects,
  selectedId,
  statuses,
  onSelect,
  onRemove,
  onAdd,
  codeServerReady,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Projects</span>
        <button className="add-btn" onClick={onAdd} title="Add project folder">
          +
        </button>
      </div>

      {!codeServerReady && (
        <div className="banner banner-error">
          code-server not found.
          <br />
          Run <code>brew install code-server</code>, then restart the app.
        </div>
      )}

      <ul className="project-list">
        {projects.map((p) => {
          const status = statuses[p.id] ?? "idle";
          return (
            <li
              key={p.id}
              className={
                "project-item" + (p.id === selectedId ? " project-item-selected" : "")
              }
              onClick={() => onSelect(p.id)}
            >
              <span
                className="status-dot"
                style={{ background: statusColor[status] }}
                title={statusTitle[status]}
              />
              <div className="project-info">
                <div className="project-name">{p.name}</div>
                <div className="project-path" title={p.path}>
                  {p.path}
                </div>
              </div>
              <button
                className="remove-btn"
                title="Remove project"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(p.id);
                }}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>

      {projects.length === 0 && (
        <div className="empty-sidebar">No projects yet. Click + to add one.</div>
      )}
    </aside>
  );
}
