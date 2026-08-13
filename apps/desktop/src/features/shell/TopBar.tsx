// App header: repo + range summary, view switcher, search, repo stats,
// panel collapse, refresh banner.

import { useEffect, useState } from "react";
import { api } from "../../lib/ipc";
import { formatCount } from "../../lib/format";
import { frameSha, useReplay, type ViewMode } from "../../stores/replay";
import { SearchBar } from "../search/SearchBar";
import { BranchIcon, RefreshIcon } from "../../components/Icons";
import type { SnapshotStats } from "../../lib/types";

const VIEWS: Array<{ id: ViewMode; label: string; key: string }> = [
  { id: "step", label: "Step", key: "1" },
  { id: "snapshot", label: "Snapshot", key: "2" },
  { id: "evolution", label: "File Evolution", key: "3" },
  { id: "map", label: "Map", key: "4" },
];

function RepoStats({ sha, repoId }: { sha: string; repoId: number }) {
  const [stats, setStats] = useState<SnapshotStats | null>(null);
  useEffect(() => {
    if (sha === "WORKTREE") {
      setStats(null);
      return;
    }
    setStats(null);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .getSnapshotStats(repoId, sha)
        .then((s) => {
          if (!cancelled) setStats(s);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sha, repoId]);
  if (!stats) return <span className="stat dim">…</span>;
  return (
    <>
      <span className="stat" title="Files in the repository at this commit">{formatCount(stats.files)} files</span>
      <span className="stat" title="Directories">{formatCount(stats.dirs)} dirs</span>
      {stats.loc !== null && <span className="stat" title="Lines of code (text files)">{formatCount(stats.loc)} LOC</span>}
    </>
  );
}

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const repo = useReplay((s) => s.repo);
  const range = useReplay((s) => s.range);
  const pr = useReplay((s) => s.pr);
  const index = useReplay((s) => s.index);
  const view = useReplay((s) => s.view);
  const hasWorkingTree = useReplay((s) => s.hasWorkingTree);
  const repoChanged = useReplay((s) => s.repoChanged);
  const refreshRepo = useReplay((s) => s.refreshRepo);
  const leftCollapsed = useReplay((s) => s.leftCollapsed);
  const setView = useReplay((s) => s.setView);
  const set = useReplay.setState;

  const sha = range ? frameSha(range, index, hasWorkingTree) : null;
  const baseLabel = range ? range.baseSha.slice(0, 7) : "";
  const headLabel = range ? range.headSha.slice(0, 7) : "";

  return (
    <header className="topbar">
      <button className="repo-chip" onClick={() => set({ range: null, pr: null })} title="Change replay range">
        <span className="repo-name">{repo?.path.split(/[\\/]/).pop() || "Git Replay"}</span>
        {pr && (
          <span className="dim repo-range" title={pr.title}>
            PR #{pr.number}
            {pr.resolvedVersion !== null && ` · v${pr.resolvedVersion}`}
          </span>
        )}
        {range && !pr && (
          <span className="dim repo-range">
            <BranchIcon size={11} /> {baseLabel} → {headLabel}
          </span>
        )}
      </button>

      {range && (
        <>
          <button
            className="btn-icon"
            onClick={() => set({ leftCollapsed: !leftCollapsed })}
            title={leftCollapsed ? "Show side panel" : "Hide side panel"}
            aria-label="Toggle side panel"
          >
            <PanelIcon size={14} />
          </button>
          <div className="view-tabs" role="tablist">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={view === v.id}
                className={`view-tab ${view === v.id ? "active" : ""}`}
                onClick={() => setView(v.id)}
                title={`${v.label} view (${v.key})`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="topbar-spacer" />

      {range && repo && sha && (
        <div className="repo-stats">
          <RepoStats sha={sha} repoId={repo.id} />
        </div>
      )}

      {range && <SearchBar />}

      <button className="btn-icon palette-trigger" onClick={onOpenPalette} title="Command palette (Ctrl+K)">
        <span className="palette-trigger-label">⌘K</span>
      </button>

      {repoChanged && (
        <div className="repo-changed-banner" role="status">
          <span>Repository changed — new commits or branch switch detected.</span>
          <button className="btn btn-primary" onClick={() => void refreshRepo()}>
            <RefreshIcon size={13} /> Refresh
          </button>
          <button className="btn-icon" onClick={() => set({ repoChanged: false })} title="Dismiss" aria-label="Dismiss">
            <span style={{ fontSize: 12 }}>✕</span>
          </button>
        </div>
      )}
    </header>
  );
}

function PanelIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M6 3v10" />
    </svg>
  );
}
