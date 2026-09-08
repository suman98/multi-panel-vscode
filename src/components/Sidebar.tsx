import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Account, Project, ProjectStatus } from "../types";
import { parentPath, relativeTime } from "../format";
import { ProjectMenu } from "./ProjectMenu";

interface SidebarProps {
  width: number;
  projects: Project[];
  selectedId: string | null;
  statuses: Record<string, ProjectStatus>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (order: string[]) => void;
  onAdd: () => void;
  onToggleFavorite: (id: string) => void;
  onColor: (id: string, color: string | null) => void;
  onUploadIcon: (id: string) => void;
  onClearIcon: (id: string) => void;
  onOpenInVscode: (id: string) => void;
  accounts: Account[];
  onAccount: (id: string, accountId: string | null) => void;
  onManageAccounts: () => void;
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

type GroupKey = "fav" | "other" | "results";

interface Group {
  key: GroupKey;
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
  // Manual order — the array is the order. Favourites float to the top but
  // keep their own manual order; nothing reorders on select.
  const favorites = projects.filter((p) => p.favorite);
  const others = projects.filter((p) => !p.favorite);
  const groups: Group[] = [];
  if (favorites.length) groups.push({ key: "fav", label: "Favourites", items: favorites });
  if (others.length) groups.push({ key: "other", label: "Projects", items: others });
  return groups;
}

function GripIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <g fill="currentColor">
        <circle cx="6" cy="4" r="1.15" />
        <circle cx="10" cy="4" r="1.15" />
        <circle cx="6" cy="8" r="1.15" />
        <circle cx="10" cy="8" r="1.15" />
        <circle cx="6" cy="12" r="1.15" />
        <circle cx="10" cy="12" r="1.15" />
      </g>
    </svg>
  );
}

const DRAG_THRESHOLD = 4;
const EDGE_ZONE = 48; // px from list edge where auto-scroll kicks in
const EDGE_SPEED = 16; // max px per frame
const SHIFT_EASE = "transform 180ms cubic-bezier(0.2, 0.75, 0.3, 1)";

interface DragState {
  id: string;
  group: GroupKey;
  pointerId: number;
  handle: HTMLElement;
  startX: number;
  startY: number;
  startContentY: number;
  active: boolean;
  index: number;
  order: string[];
  /** original layout centres, in list-content space (survives scrolling) */
  centers: number[];
  height: number;
  target: number;
  clientY: number;
  frame: number | null;
}

export default function Sidebar({
  width,
  projects,
  selectedId,
  statuses,
  onSelect,
  onClose,
  onRemove,
  onReorder,
  onAdd,
  onToggleFavorite,
  onColor,
  onUploadIcon,
  onClearIcon,
  onOpenInVscode,
  accounts,
  onAccount,
  onManageAccounts,
  codeServerReady,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const groups = useMemo(() => buildGroups(projects, query), [projects, query]);
  const menuProject = menu ? projects.find((p) => p.id === menu.id) ?? null : null;
  const canDrag = !query.trim();

  // ── pointer-based drag reorder (WKWebView has no usable HTML5 DnD) ──────────
  // The dragged row follows the pointer 1:1 while its neighbours slide out of
  // the way, so the list reads like a native sortable list rather than a
  // drop-line indicator.
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const drag = useRef<DragState | null>(null);

  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const rowEl = (id: string) => rowEls.current.get(id) ?? null;

  const contentY = useCallback((clientY: number) => {
    const list = listRef.current;
    if (!list) return clientY;
    return clientY - list.getBoundingClientRect().top + list.scrollTop;
  }, []);

  /** Position the dragged row under the pointer and shift its neighbours. */
  const paint = useCallback(() => {
    const d = drag.current;
    if (!d || !d.active) return;
    d.frame = null;

    const dragged = rowEl(d.id);
    if (!dragged) return;

    const first = d.centers[0];
    const last = d.centers[d.centers.length - 1];
    const raw = contentY(d.clientY) - d.startContentY;
    const dy = Math.max(first - d.centers[d.index], Math.min(last - d.centers[d.index], raw));
    dragged.style.transform = `translate3d(0, ${dy}px, 0)`;

    const center = d.centers[d.index] + dy;
    let target = 0;
    for (let j = 0; j < d.centers.length; j++) {
      if (j !== d.index && d.centers[j] < center) target++;
    }
    d.target = target;

    for (let j = 0; j < d.order.length; j++) {
      if (j === d.index) continue;
      const el = rowEl(d.order[j]);
      if (!el) continue;
      let shift = 0;
      if (j > d.index && j <= target) shift = -d.height;
      else if (j < d.index && j >= target) shift = d.height;
      el.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : "";
    }
  }, [contentY]);

  const schedule = useCallback(() => {
    const d = drag.current;
    if (!d || !d.active || d.frame !== null) return;
    d.frame = requestAnimationFrame(() => paint());
  }, [paint]);

  /** Scroll the list when the pointer sits near its top/bottom edge. */
  const autoScroll = useCallback(() => {
    const d = drag.current;
    const list = listRef.current;
    if (!d || !d.active || !list) return;
    const r = list.getBoundingClientRect();
    let delta = 0;
    if (d.clientY < r.top + EDGE_ZONE) {
      delta = -EDGE_SPEED * Math.min(1, (r.top + EDGE_ZONE - d.clientY) / EDGE_ZONE);
    } else if (d.clientY > r.bottom - EDGE_ZONE) {
      delta = EDGE_SPEED * Math.min(1, (d.clientY - (r.bottom - EDGE_ZONE)) / EDGE_ZONE);
    }
    if (delta) {
      const before = list.scrollTop;
      list.scrollTop = before + delta;
      if (list.scrollTop !== before) paint();
    }
    requestAnimationFrame(autoScroll);
  }, [paint]);

  const startDrag = useCallback(
    (d: DragState) => {
      const items = groupsRef.current.find((g) => g.key === d.group)?.items ?? [];
      const list = listRef.current;
      if (items.length < 2 || !list) return false;

      const order = items.map((p) => p.id);
      const index = order.indexOf(d.id);
      if (index < 0) return false;

      const listTop = list.getBoundingClientRect().top;
      const centers: number[] = [];
      let height = 0;
      for (const id of order) {
        const el = rowEl(id);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        centers.push(r.top - listTop + list.scrollTop + r.height / 2);
        height = r.height;
      }
      // Row pitch, not row height — rows may be separated by margins.
      if (centers.length > 1) height = centers[1] - centers[0];

      d.active = true;
      d.order = order;
      d.index = index;
      d.centers = centers;
      d.height = height;
      d.target = index;

      for (let j = 0; j < order.length; j++) {
        const el = rowEl(order[j]);
        if (el) el.style.transition = j === index ? "none" : SHIFT_EASE;
      }
      document.body.classList.add("dnd-active");
      setDragId(d.id);
      requestAnimationFrame(autoScroll);
      paint();
      return true;
    },
    [autoScroll, paint],
  );

  const finishDrag = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.frame !== null) cancelAnimationFrame(d.frame);
    try {
      d.handle.releasePointerCapture(d.pointerId);
    } catch {
      /* pointer already gone */
    }
    if (!d.active) return;

    document.body.classList.remove("dnd-active");
    for (const id of d.order) {
      const el = rowEl(id);
      if (!el) continue;
      el.style.transition = "";
      el.style.transform = "";
    }
    setDragId(null);

    if (d.target !== d.index) {
      const ids = d.order.filter((x) => x !== d.id);
      ids.splice(d.target, 0, d.id);
      const other = (key: GroupKey) =>
        groupsRef.current.find((g) => g.key === key)?.items.map((p) => p.id) ?? [];
      const favIds = d.group === "fav" ? ids : other("fav");
      const otherIds = d.group === "other" ? ids : other("other");
      onReorder([...favIds, ...otherIds]);
    }
  }, [onReorder]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.clientY = e.clientY;

      if (!d.active) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
        if (!startDrag(d)) {
          drag.current = null;
          return;
        }
      }
      e.preventDefault();
      schedule();
    }

    function onUp(e: PointerEvent) {
      if (drag.current && e.pointerId !== drag.current.pointerId) return;
      finishDrag();
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && drag.current) {
        const d = drag.current;
        d.target = d.index; // snap back, no reorder
        finishDrag();
      }
    }

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [finishDrag, schedule, startDrag]);

  function onHandlePointerDown(e: React.PointerEvent<HTMLElement>, p: Project, group: GroupKey) {
    if (!canDrag || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    drag.current = {
      id: p.id,
      group,
      pointerId: e.pointerId,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startContentY: contentY(e.clientY),
      active: false,
      index: 0,
      order: [],
      centers: [],
      height: 0,
      target: 0,
      clientY: e.clientY,
      frame: null,
    };
  }

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

      <div className="project-list" ref={listRef}>
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
                  ref={(el) => {
                    if (el) rowEls.current.set(p.id, el);
                    else rowEls.current.delete(p.id);
                  }}
                  className={
                    "project-item" +
                    (p.id === selectedId ? " project-item-selected" : "") +
                    (dragId === p.id ? " dragging" : "") +
                    (dragId && dragId !== p.id ? " dnd-idle" : "")
                  }
                  style={p.color ? ({ "--proj-color": p.color } as CSSProperties) : undefined}
                  onClick={() => onSelect(p.id)}
                  title={p.path}
                >
                  <span
                    className={"drag-handle" + (canDrag ? "" : " off")}
                    role="button"
                    aria-label="Reorder project"
                    onPointerDown={(e) => onHandlePointerDown(e, p, group.key)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <GripIcon />
                  </span>
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
                    <div className="project-path">{parentPath(p.path)}</div>
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
                    <span className="when-slot">
                      <span className="when idle">{p.last_opened ? relativeTime(p.last_opened) : ""}</span>
                    </span>
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
          onOpenInVscode={() => {
            setMenu(null);
            onOpenInVscode(menuProject.id);
          }}
          accounts={accounts}
          onAccount={(accountId) => {
            setMenu(null);
            onAccount(menuProject.id, accountId);
          }}
          onManageAccounts={() => {
            setMenu(null);
            onManageAccounts();
          }}
        />
      )}
    </aside>
  );
}
