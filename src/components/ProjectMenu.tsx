import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Account, Project } from "../types";

export const PROJECT_COLORS = [
  "#0e639c",
  "#8b7bff",
  "#c58fff",
  "#f38ec4",
  "#f14c4c",
  "#d9a940",
  "#3fb950",
  "#4bc8d6",
] as const;

interface Props {
  project: Project;
  anchor: HTMLElement;
  onClose: () => void;
  onToggleFavorite: () => void;
  onColor: (color: string | null) => void;
  onUploadIcon: () => void;
  onClearIcon: () => void;
  onRemove: () => void;
  onOpenInVscode: () => void;
  accounts: Account[];
  /** `null` = Claude Code's own keychain login */
  onAccount: (accountId: string | null) => void;
  onManageAccounts: () => void;
}

export function ProjectMenu({
  project,
  anchor,
  onClose,
  onToggleFavorite,
  onColor,
  onUploadIcon,
  onClearIcon,
  onRemove,
  onOpenInVscode,
  accounts,
  onAccount,
  onManageAccounts,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });

  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const m = ref.current?.getBoundingClientRect();
    const w = m?.width ?? 200;
    const h = m?.height ?? 170;
    let left = a.right - w;
    let top = a.bottom + 6;
    if (left < 8) left = 8;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - 8 - w;
    if (top + h > window.innerHeight - 8) top = a.top - h - 6;
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, onClose]);

  

  return createPortal(
    <div className="proj-menu" ref={ref} style={{ top: pos.top, left: pos.left }}>
      <button className="pm-item" onClick={onOpenInVscode}>
       Open in new Editor
      </button>

      <button className="pm-item" onClick={onToggleFavorite}>
        <span className={"pm-star" + (project.favorite ? " on" : "")}>
          {project.favorite ? "★" : "☆"}
        </span>
        {project.favorite ? "Remove from Favourites" : "Add to Favourites"}
      </button>

      <div className="pm-sep" />
      <div className="pm-section-label">Colour</div>
      <div className="pm-colors">
        {PROJECT_COLORS.map((c) => (
          <button
            key={c}
            className={"pm-swatch" + (project.color === c ? " on" : "")}
            style={{ background: c }}
            onClick={() => onColor(c)}
            aria-label={`Colour ${c}`}
          />
        ))}
        <button
          className={"pm-swatch pm-none" + (!project.color ? " on" : "")}
          onClick={() => onColor(null)}
          title="No colour"
          aria-label="No colour"
        >
          ⊘
        </button>
      </div>

      <div className="pm-sep" />
      <button className="pm-item" onClick={onUploadIcon}>
        {project.icon ? "Replace icon…" : "Upload icon…"}
      </button>
      {project.icon && (
        <button className="pm-item" onClick={onClearIcon}>
          Remove icon
        </button>
      )}

      <div className="pm-sep" />
      <div className="pm-section-label">Claude account</div>
      <button
        className={"pm-item pm-check" + (!project.account_id ? " on" : "")}
        onClick={() => onAccount(null)}
      >
        <span className="pm-tick">{!project.account_id ? "✓" : ""}</span>
        Default (logged-in account)
      </button>
      {accounts.map((a) => (
        <button
          key={a.id}
          className={"pm-item pm-check" + (project.account_id === a.id ? " on" : "")}
          onClick={() => onAccount(a.id)}
          title={a.hint}
        >
          <span className="pm-tick">{project.account_id === a.id ? "✓" : ""}</span>
          {a.label}
        </button>
      ))}
      <button className="pm-item" onClick={onManageAccounts}>
        Manage accounts…
      </button>

      <div className="pm-sep" />
      <button className="pm-item danger" onClick={onRemove}>
        Remove from list
      </button>
    </div>,
    document.body,
  );
}
