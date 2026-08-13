// Presentation helpers.

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const opts: Intl.DateTimeFormatOptions = sameYear
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" };
  return d.toLocaleDateString(undefined, opts);
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/** Absolute time ("3 days ago") for timeline tooltips. */
export function timeAgo(ts: number): string {
  const diffSec = Math.max(0, Date.now() / 1000 - ts);
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Escape text for embedding in the diff renderer before highlighting. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function statusLabel(status: string): string {
  switch (status) {
    case "added": return "created";
    case "modified": return "modified";
    case "deleted": return "deleted";
    case "renamed": return "moved";
    case "copied": return "copied";
    case "typeChanged": return "type changed";
    default: return status;
  }
}

export function isLikelyImage(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i.test(path);
}

/** Heuristic for generated / noisy files (invariant: never silently hidden). */
export function isGeneratedPath(path: string): boolean {
  const name = basename(path).toLowerCase();
  if (
    name === "package-lock.json" || name === "pnpm-lock.yaml" || name === "yarn.lock" ||
    name === "cargo.lock" || name === "composer.lock" || name === "go.sum" ||
    name === "poetry.lock" || name === "gemfile.lock" || name === "bun.lockb" ||
    name.endsWith(".min.js") || name.endsWith(".min.css") || name.endsWith(".map") ||
    name.endsWith(".lock") || name.endsWith(".sum")
  ) {
    return true;
  }
  return (
    /(^|\/)(dist|build|out|node_modules|vendor|\.next|\.nuxt|\.turbo|target)\//.test(path) ||
    /(^|\/)(generated|gen)\//.test(path) ||
    /\.(pyc|pyo|class|o|a|so|dll|exe|bin|jar|war|wasm|zip|gz|tar)$/i.test(path)
  );
}
