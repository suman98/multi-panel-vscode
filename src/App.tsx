import { useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import ProjectPanel from "./components/ProjectPanel";
import { Resizer } from "./components/Resizer";
import {
  checkCodeServer,
  confirmDialog,
  loadProjects,
  pickFolder,
  pickImage,
  readImageAsDataUrl,
  revealTerminal,
  saveProjects,
  startProject,
  stopProject,
} from "./api";
import type { Project, ProjectStatus } from "./types";
import "./App.css";

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 440;

function nameFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Index where the favourites block ends (== the first non-favourite). */
function favoritesBoundary(projects: Project[]): number {
  const idx = projects.findIndex((p) => !p.favorite);
  return idx === -1 ? projects.length : idx;
}

function App() {
  const [projects, setProjectsState] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ports, setPorts] = useState<Record<string, number>>({});
  const [statuses, setStatuses] = useState<Record<string, ProjectStatus>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [codeServerReady, setCodeServerReady] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => stored("mvp.sidebarWidth", 260));
  const [resizing, setResizing] = useState(false);
  const loaded = useRef(false);

  // Persist projects and update state together, so every mutation (favorite,
  // colour, icon, add, remove) goes through one place.
  const setProjects = (next: Project[] | ((prev: Project[]) => Project[])) => {
    setProjectsState((prev) => {
      const value = typeof next === "function" ? (next as (p: Project[]) => Project[])(prev) : next;
      if (loaded.current) saveProjects(value).catch((e) => console.error("failed to save projects", e));
      return value;
    });
  };

  const showError = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((cur) => (cur === msg ? null : cur)), 4500);
  };

  // Load persisted projects + verify code-server is installed, once on mount.
  useEffect(() => {
    loadProjects()
      .then((p) => setProjectsState(p))
      .catch((e) => console.error("failed to load projects", e))
      .finally(() => {
        loaded.current = true;
      });

    checkCodeServer()
      .then(() => setCodeServerReady(true))
      .catch(() => setCodeServerReady(false));
  }, []);

  useEffect(() => remember("mvp.sidebarWidth", sidebarWidth), [sidebarWidth]);

  async function launch(project: Project) {
    setStatuses((s) => ({ ...s, [project.id]: "starting" }));
    setErrors((e) => {
      const next = { ...e };
      delete next[project.id];
      return next;
    });
    try {
      const port = await startProject(project.id, project.path);
      setPorts((p) => ({ ...p, [project.id]: port }));
      setStatuses((s) => ({ ...s, [project.id]: "running" }));
    } catch (err) {
      setStatuses((s) => ({ ...s, [project.id]: "error" }));
      setErrors((e) => ({ ...e, [project.id]: String(err) }));
    }
  }

  // `project` can be passed directly for a project that isn't in `projects`
  // state yet (React hasn't re-rendered after setProjects); looking it up by
  // id here would silently find nothing and skip launch() forever.
  function selectProject(id: string, project?: Project) {
    setSelectedId(id);
    const target = project ?? projects.find((p) => p.id === id);
    if (target && !ports[id] && statuses[id] !== "starting") {
      launch(target);
    }
  }

  async function addProject() {
    const path = await pickFolder();
    if (!path) return;
    const existing = projects.find((p) => p.path === path);
    if (existing) {
      selectProject(existing.id, existing);
      return;
    }
    const project: Project = {
      id: crypto.randomUUID(),
      name: nameFromPath(path),
      path,
      favorite: false,
      color: null,
      icon: null,
    };
    setProjects((prev) => [...prev, project]);
    selectProject(project.id, project);
  }

  async function removeProject(id: string) {
    const project = projects.find((p) => p.id === id);
    const label = project ? project.name : "this project";
    const ok = await confirmDialog(`This stops its VS Code instance.`, `Remove "${label}"?`);
    if (!ok) return;

    try {
      await stopProject(id);
    } catch (e) {
      console.error("failed to stop project server", e);
    }

    setProjects((prev) => prev.filter((p) => p.id !== id));
    setPorts((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
    setStatuses((s) => {
      const next = { ...s };
      delete next[id];
      return next;
    });
    setSelectedId((current) => (current === id ? null : current));
  }

  /** Tear down a project's VS Code without forgetting the project itself. */
  async function closeProject(id: string) {
    try {
      await stopProject(id);
    } catch (e) {
      showError(String(e));
    }
    setPorts((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
    setStatuses((s) => ({ ...s, [id]: "idle" }));
  }

  function toggleFavorite(id: string) {
    setProjects((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx === -1) return prev;
      const next = [...prev];
      const [proj] = next.splice(idx, 1);
      proj.favorite = !proj.favorite;
      // Favourited → bottom of the favourites block; unfavourited → top of the
      // rest. Both land at the favourites/others boundary.
      next.splice(favoritesBoundary(next), 0, proj);
      return next;
    });
  }

  function setColor(id: string, color: string | null) {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, color } : p)));
  }

  async function uploadIcon(id: string) {
    const src = await pickImage();
    if (!src) return;
    try {
      const icon = await readImageAsDataUrl(src);
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, icon } : p)));
    } catch (e) {
      showError(String(e));
    }
  }

  function clearIcon(id: string) {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, icon: null } : p)));
  }

  function showTerminal(path: string) {
    revealTerminal(path).catch((e) => showError(String(e)));
  }

  function retry(id: string) {
    const project = projects.find((p) => p.id === id);
    if (project) launch(project);
  }

  const sidebarMax = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, window.innerWidth - 380));

  return (
    <div className="app">
      <Sidebar
        width={sidebarWidth}
        projects={projects}
        selectedId={selectedId}
        statuses={statuses}
        onSelect={selectProject}
        onClose={closeProject}
        onRemove={removeProject}
        onAdd={addProject}
        onToggleFavorite={toggleFavorite}
        onColor={setColor}
        onUploadIcon={uploadIcon}
        onClearIcon={clearIcon}
        codeServerReady={codeServerReady}
      />
      <Resizer
        width={sidebarWidth}
        min={SIDEBAR_MIN}
        max={sidebarMax}
        onResize={setSidebarWidth}
        onDragStart={() => setResizing(true)}
        onDragEnd={() => setResizing(false)}
      />
      {flash && <div className="notice error">{flash}</div>}
      <ProjectPanel
        projects={projects}
        selectedId={selectedId}
        ports={ports}
        statuses={statuses}
        errors={errors}
        onRetry={retry}
        onShowTerminal={showTerminal}
      />
      {resizing && <div className="resize-shield" />}
    </div>
  );
}

function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window, non-fatal */
  }
}

export default App;
