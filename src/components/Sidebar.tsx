import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Project, ProjectStatus } from "../types";
import { ProjectMenu } from "./ProjectMenu";

interface SidebarProps {
  width: number;
  projects: Project[];
  selectedId: string | null;
  statuses: Record<string, ProjectStatus>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onToggleFavorite: (id: string) => void;
  onColor: (id: string, color: string | null) => void;
  onUploadIcon: (id: string) => void;
  onClearIcon: (id: string) => void;
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

interface Group {
  key: string;
  label: string;
  items: Project[];
}

function buildGroups(projects: Project[], query: string): Group[] {
  const q = query.trim().toLowerCase();
  if (q) {
    const matches = projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
    );
    return matches.length ? [{ key: "results", label: "Results", items: matches }] : [];
  }
  const favorites = projects.filter((p) => p.favorite);
  const others = projects.filter((p) => !p.favorite);
  const groups: Group[] = [];
  if (favorites.length) groups.push({ key: "fav", label: "Favourites", items: favorites });
  if (others.length) groups.push({ key: "other", label: "Projects", items: others });
  return groups;
}

export default function Sidebar({
  width,
  projects,
  selectedId,
  statuses,
  onSelect,
  onClose,
  onRemove,
  onAdd,
  onToggleFavorite,
  onColor,
  onUploadIcon,
  onClearIcon,
  codeServerReady,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const groups = useMemo(() => buildGroups(projects, query), [projects, query]);
  const menuProject = menu ? projects.find((p) => p.id === menu.id) ?? null : null;

  return (
    <aside className="sidebar" style={{ width }}>
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

      {projects.length > 0 && (
        <div className="searchwrap">
          <input
            className="search"
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="clear-btn" onClick={() => setQuery("")} aria-label="Clear">
              ✕
            </button>
          )}
        </div>
      )}

      <div className="project-list">
        {projects.length === 0 && (
          <div className="empty-sidebar">No projects yet. Click + to add one.</div>
        )}
        {projects.length > 0 && groups.length === 0 && (
          <div className="empty-sidebar">No matches for “{query}”.</div>
        )}

        {groups.map((group) => (
          <section key={group.key}>
            <h3 className="group-label">{group.label}</h3>
            {group.items.map((p) => {
              const status = statuses[p.id] ?? "idle";
              const running = status === "running" || status === "starting";
              return (
                <div
                  key={p.id}
                  className={"project-item" + (p.id === selectedId ? " project-item-selected" : "")}
                  style={p.color ? ({ "--proj-color": p.color } as CSSProperties) : undefined}
                  onClick={() => onSelect(p.id)}
                  title={p.path}
                >
                  <span className="avatar" aria-hidden="true">
                    {p.icon ? (
                      <img className="avatar-img" src={p.icon} alt="" draggable={false} />
                    ) : (
                      p.name.slice(0, 1).toUpperCase()
                    )}
                    <span
                      className="status-dot"
                      style={{ background: statusColor[status] }}
                      title={statusTitle[status]}
                    />
                  </span>
                  <div className="project-info">
                    <div className="project-name">
                      {p.favorite && <span className="fav-star">★</span>}
                      {p.name}
                    </div>
                    <div className="project-path">{p.path}</div>
                  </div>

                  {running ? (
                    <span className="when-slot">
                      <span className="when">{status === "starting" ? "starting…" : "open"}</span>
                      <button
                        className="close-proj"
                        onClick={(e) => {
                          e.stopPropagation();
                          onClose(p.id);
                        }}
                        title={`Close ${p.name}`}
                        aria-label={`Close ${p.name}`}
                      >
                        ✕
                      </button>
                    </span>
                  ) : (
                    <span className="when-slot" />
                  )}

                  <button
                    className={"row-menu" + (menu?.id === p.id ? " open" : "")}
                    onClick={(e) => {
                      e.stopPropagation();
                      const anchor = e.currentTarget;
                      setMenu((m) => (m?.id === p.id ? null : { id: p.id, anchor }));
                    }}
                    aria-label="Project options"
                  >
                    ⋯
                  </button>
                </div>
              );
            })}
          </section>
        ))}
      </div>

      {menu && menuProject && (
        <ProjectMenu
          project={menuProject}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onToggleFavorite={() => {
            setMenu(null);
            onToggleFavorite(menuProject.id);
          }}
          onColor={(c) => onColor(menuProject.id, c)}
          onUploadIcon={() => {
            setMenu(null);
            onUploadIcon(menuProject.id);
          }}
          onClearIcon={() => {
            setMenu(null);
            onClearIcon(menuProject.id);
          }}
          onRemove={() => {
            setMenu(null);
            onRemove(menuProject.id);
          }}
        />
      )}
    </aside>
  );
}
