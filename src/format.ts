export function tildePath(p: string): string {
  // Best-effort: collapse the user's home dir to `~`.
  const m = p.match(/^\/(?:Users|home)\/([^/]+)(\/.*)?$/);
  if (m) return "~" + (m[2] ?? "");
  return p;
}

export function parentPath(p: string): string {
  const t = tildePath(p);
  const i = t.lastIndexOf("/");
  return i > 0 ? t.slice(0, i) : t;
}

const UNITS: [number, string][] = [
  [60_000, "s"],
  [3_600_000, "m"],
  [86_400_000, "h"],
  [604_800_000, "d"],
  [2_629_800_000, "w"],
  [Infinity, "mo"],
];

export function relativeTime(ms?: number | null): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 45_000) return "just now";
  let prev = 1;
  for (const [limit, label] of UNITS) {
    if (diff < limit) {
      const value = Math.round(diff / prev);
      return `${value}${label} ago`;
    }
    prev = limit;
  }
  return "";
}
