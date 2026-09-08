import { useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import ProjectPanel from "./components/ProjectPanel";
import {
  checkCodeServer,
  loadProjects,
  pickFolder,
  saveProjects,
  startProject,
  stopProject,
} from "./api";
import type { Project, ProjectStatus } from "./types";
import "./App.css";

function nameFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ports, setPorts] = useState<Record<string, number>>({});
  const [statuses, setStatuses] = useState<Record<string, ProjectStatus>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [codeServerReady, setCodeServerReady] = useState(true);
  const loaded = useRef(false);

  // Load persisted projects + verify code-server is installed, once on mount.
  useEffect(() => {
    loadProjects()
      .then(setProjects)
      .catch((e) => console.error("failed to load projects", e))
      .finally(() => {
        loaded.current = true;
      });

    checkCodeServer()
      .then(() => setCodeServerReady(true))
      .catch(() => setCodeServerReady(false));
  }, []);

  // Persist whenever the project list changes (skip the initial load itself).
  useEffect(() => {
    if (!loaded.current) return;
    saveProjects(projects).catch((e) => console.error("failed to save projects", e));
  }, [projects]);

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

  function selectProject(id: string) {
    setSelectedId(id);
    const project = projects.find((p) => p.id === id);
    if (project && !ports[id] && statuses[id] !== "starting") {
      launch(project);
    }
  }

  async function addProject() {
    const path = await pickFolder();
    if (!path) return;
    if (projects.some((p) => p.path === path)) {
      const existing = projects.find((p) => p.path === path)!;
      selectProject(existing.id);
      return;
    }
    const project: Project = {
      id: crypto.randomUUID(),
      name: nameFromPath(path),
      path,
    };
    setProjects((prev) => [...prev, project]);
    selectProject(project.id);
  }

  async function removeProject(id: string) {
    const project = projects.find((p) => p.id === id);
    const label = project ? project.name : "this project";
    if (!confirm(`Remove "${label}"? This stops its VS Code instance.`)) return;

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

  function retry(id: string) {
    const project = projects.find((p) => p.id === id);
    if (project) launch(project);
  }

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        selectedId={selectedId}
        statuses={statuses}
        onSelect={selectProject}
        onRemove={removeProject}
        onAdd={addProject}
        codeServerReady={codeServerReady}
      />
      <ProjectPanel
        projects={projects}
        selectedId={selectedId}
        ports={ports}
        statuses={statuses}
        errors={errors}
        onRetry={retry}
      />
    </div>
  );
}

export default App;
