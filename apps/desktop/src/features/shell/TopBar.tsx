// App header: repo + range summary, view switcher, search, repo stats.

import { useEffect, useState } from "react";
import { api } from "../../lib/ipc";
import { formatCount } from "../../lib/format";
import { frameSha, useReplay, type ViewMode } from "../../stores/replay";
import { SearchBar } from "../search/SearchBar";
import { BranchIcon } from "../../components/Icons";
import type { SnapshotStats } from "../../lib/types";

const VIEWS: Array<{ id: ViewMode; label: string; key: string }> = [
  { id: "step", label: "Step", key: "1" },
  { id: "snapshot", label: "Snapshot", key: "2" },
  { id: "evolution", label: "File Evolution", key: "3" },
];

function RepoStats({ sha, repoId }: { sha: string; repoId: number }) {
  const [stats, setStats] = useState<SnapshotStats | null>(null);
  useEffect(() => {
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
  const index = useReplay((s) => s.index);
  const view = useReplay((s) => s.view);
  const setView = useReplay((s) => s.setView);
  const set = useReplay.setState;

  const sha = range ? frameSha(range, index) : null;
  const baseLabel = range ? range.baseSha.slice(0, 7) : "";
  const headLabel = range ? range.headSha.slice(0, 7) : "";

  return (
    <header className="topbar">
      <button className="repo-chip" onClick={() => set({ range: null })} title="Change replay range">
        <span className="repo-name">{repo?.path.split(/[\\/]/).pop() || "Git Replay"}</span>
        {range && (
          <span className="dim repo-range">
            <BranchIcon size={11} /> {baseLabel} → {headLabel}
          </span>
        )}
      </button>

      {range && (
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
    </header>
  );
}
