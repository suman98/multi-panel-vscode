import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
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

const DEFAULT_CUSTOM = "#7c9cff";

/** `#abc` / `abcdef` / `#ABCDEF` → `#aabbcc`. Returns null for anything else. */
function normalizeHex(value: string): string | null {
  const s = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) {
    return "#" + s.toLowerCase().split("").map((c) => c + c).join("");
  }
  if (/^[0-9a-f]{6}$/i.test(s)) return "#" + s.toLowerCase();
  return null;
}

function isPreset(color: string | null | undefined): boolean {
  return !!color && (PROJECT_COLORS as readonly string[]).includes(color.toLowerCase());
}

interface Hsv {
  h: number;
  s: number;
  v: number;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const norm = normalizeHex(hex);
  if (!norm) return null;
  const n = parseInt(norm.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0"))
      .join("")
  );
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const face = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(h / 60) % 6];
  return rgbToHex((face[0] + m) * 255, (face[1] + m) * 255, (face[2] + m) * 255);
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Saturation/value square + hue strip, drawn in the DOM.
 *
 *  Deliberately not `<input type="color">`: that hands off to the OS colour
 *  panel, which WKWebView runs out-of-process — the panel opens but the picked
 *  value often never comes back as an input event, so the choice silently
 *  vanishes. Plain divs and pointer events behave the same everywhere. */
function CustomColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const fromValue = (hex: string): Hsv => {
    const rgb = hexToRgb(hex);
    return rgb ? rgbToHsv(rgb[0], rgb[1], rgb[2]) : { h: 220, s: 0.5, v: 1 };
  };

  const [hsv, setHsv] = useState<Hsv>(() => fromValue(value));
  // What we last pushed upward. Lets an outside change (typing a hex, picking
  // a preset) reseed the picker without a round-trip clobbering the live drag,
  // where h/s/v carry more information than the hex they collapse into.
  const emitted = useRef(value.toLowerCase());

  useEffect(() => {
    if (value.toLowerCase() === emitted.current) return;
    emitted.current = value.toLowerCase();
    setHsv(fromValue(value));
  }, [value]);

  const apply = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    emitted.current = hex;
    onChange(hex);
  };

  const track = (e: React.PointerEvent<HTMLDivElement>, pick: (x: number, y: number) => void) => {
    const r = e.currentTarget.getBoundingClientRect();
    pick(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
  };

  const grab = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const pickSv = (e: React.PointerEvent<HTMLDivElement>) =>
    track(e, (x, y) => apply({ ...hsv, s: x, v: 1 - y }));

  const pickHue = (e: React.PointerEvent<HTMLDivElement>) =>
    track(e, (x) => apply({ ...hsv, h: x * 360 }));

  const hueHex = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  return (
    <div className="pm-picker">
      <div
        className="pm-sv"
        style={{ "--hue": hueHex } as CSSProperties}
        onPointerDown={(e) => {
          grab(e);
          pickSv(e);
        }}
        onPointerMove={(e) => e.buttons & 1 && pickSv(e)}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`}
      >
        <span
          className="pm-sv-thumb"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }}
        />
      </div>
      <div
        className="pm-hue"
        onPointerDown={(e) => {
          grab(e);
          pickHue(e);
        }}
        onPointerMove={(e) => e.buttons & 1 && pickHue(e)}
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
      >
        <span className="pm-hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, background: hueHex }} />
      </div>
    </div>
  );
}

/** Gap between the anchor and the menu, and the minimum breathing room kept
    against the window edges. */
const GAP = 6;
const EDGE = 8;
/** Never squash the menu below this — past it, scroll instead. */
const MIN_HEIGHT = 140;

type Side = "below" | "above";

interface Placement {
  top: number;
  left: number;
  maxHeight: number;
  side: Side;
}

const OFFSCREEN: Placement = { top: -9999, left: -9999, maxHeight: 0, side: "below" };

const samePlacement = (a: Placement, b: Placement) =>
  a.top === b.top && a.left === b.left && a.maxHeight === b.maxHeight && a.side === b.side;

/** Where to put a `w`×`wanted` menu against `anchor`, inside `vw`×`vh`.
 *
 *  Pure geometry, kept out of the component so it can be reasoned about (and
 *  tested) on its own. `forced` is the user's manual flip; when it is null the
 *  side is chosen automatically. */
export function computePlacement(
  anchor: { top: number; bottom: number; right: number },
  w: number,
  wanted: number,
  vw: number,
  vh: number,
  forced: Side | null,
): Placement {
  const left = Math.max(EDGE, Math.min(anchor.right - w, vw - EDGE - w));

  const roomBelow = vh - EDGE - (anchor.bottom + GAP);
  const roomAbove = anchor.top - GAP - EDGE;
  // Prefer below; only flip up if the menu doesn't fit below *and* there is
  // genuinely more space above. The old code flipped without checking, so a
  // tall menu on a low anchor slid straight off the top of the window.
  const side: Side = forced ?? (wanted <= roomBelow || roomBelow >= roomAbove ? "below" : "above");

  const maxHeight = Math.max(MIN_HEIGHT, side === "below" ? roomBelow : roomAbove);
  const height = Math.min(wanted, maxHeight);
  const top = Math.max(
    EDGE,
    Math.min(side === "below" ? anchor.bottom + GAP : anchor.top - GAP - height, vh - EDGE - height),
  );

  return { top, left, maxHeight, side };
}

/** Arrows pointing apart — flip which way the menu opens. */
function FlipIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.8V3.2M2.9 5.3L5 3.2l2.1 2.1" />
      <path d="M11 3.2v9.6M13.1 10.7L11 12.8l-2.1-2.1" />
    </svg>
  );
}

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
  const [pos, setPos] = useState<Placement>(OFFSCREEN);
  // null = pick whichever side fits; set once the user flips it by hand, and
  // then honoured even if that side is the tighter one — that's the point of
  // the control.
  const [side, setSide] = useState<Side | null>(null);
  // A colour that isn't one of the presets can only have come from the custom
  // picker, so reopen the menu with that section already expanded.
  const custom = project.color && !isPreset(project.color) ? project.color : null;
  const [customOpen, setCustomOpen] = useState(!!custom);
  const [hexText, setHexText] = useState(custom ?? "");
  const swatchValue = normalizeHex(hexText) ?? custom ?? DEFAULT_CUSTOM;

  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // scrollHeight, not the rect: once maxHeight caps the box the rect stops
    // reporting how tall the content actually wants to be, and each measure
    // would shrink the menu a little further. +2 covers the 1px borders.
    const next = computePlacement(
      anchor.getBoundingClientRect(),
      el.offsetWidth || 200,
      el.scrollHeight + 2,
      window.innerWidth,
      window.innerHeight,
      side,
    );
    setPos((cur) => (samePlacement(cur, next) ? cur : next));
  }, [anchor, side]);

  useLayoutEffect(() => {
    place();
    // The menu changes height while it is open — expanding the colour picker
    // is the obvious case — so re-place on its own resize rather than only on
    // mount, which is what let it overflow the window.
    const el = ref.current;
    const ro = el ? new ResizeObserver(() => place()) : null;
    if (el && ro) ro.observe(el);
    window.addEventListener("resize", place);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [place]);

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
    <div
      className="proj-menu"
      ref={ref}
      style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight || undefined }}
    >
      <div className="pm-head">
        <span className="pm-head-name" title={project.name}>
          {project.name}
        </span>
        <button
          className="pm-flip"
          onClick={() => setSide(pos.side === "below" ? "above" : "below")}
          title={pos.side === "below" ? "Open menu upwards" : "Open menu downwards"}
          aria-label={pos.side === "below" ? "Open menu upwards" : "Open menu downwards"}
        >
          <FlipIcon />
        </button>
      </div>

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
        <button
          className={"pm-swatch pm-custom" + (custom ? " on" : "")}
          style={custom ? { background: custom } : undefined}
          onClick={() => setCustomOpen((v) => !v)}
          title="Custom colour…"
          aria-label="Custom colour"
          aria-expanded={customOpen}
        >
          {custom ? "" : "+"}
        </button>
      </div>

      {customOpen && (
        <div className="pm-custom-panel">
          <CustomColorPicker
            value={swatchValue}
            onChange={(hex) => {
              setHexText(hex);
              onColor(hex);
            }}
          />
          <div className="pm-custom-row">
            <span className="pm-custom-preview" style={{ background: swatchValue }} />
            <input
              className="pm-hex"
              value={hexText}
              placeholder="#rrggbb"
              spellCheck={false}
              autoComplete="off"
              maxLength={7}
              aria-label="Custom colour hex"
              onChange={(e) => {
                setHexText(e.target.value);
                const hex = normalizeHex(e.target.value);
                if (hex) onColor(hex);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const hex = normalizeHex(hexText);
                if (hex) {
                  setHexText(hex);
                  onColor(hex);
                }
              }}
            />
          </div>
        </div>
      )}

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
