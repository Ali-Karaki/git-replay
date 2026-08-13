// App header: repo + range summary, repo stats, search, command palette,
// refresh banner. View switching and settings live in the sidebar.

import { useEffect, useState } from "react";
import { BranchIcon, RefreshIcon } from "../../components/Icons";
import { formatCount } from "../../lib/format";
import { api } from "../../lib/ipc";
import type { SnapshotStats } from "../../lib/types";
import { frameSha, useReplay } from "../../stores/replay";
import { SearchBar } from "../search/SearchBar";

/** The palette shortcut is Ctrl+K everywhere except macOS (⌘K). */
const PALETTE_KEY_LABEL = /mac/i.test(navigator.platform) ? "⌘K" : "Ctrl K";

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
      <span className="stat" title="Files in the repository at this commit">
        {formatCount(stats.files)} files
      </span>
      <span className="stat" title="Directories">
        {formatCount(stats.dirs)} dirs
      </span>
      {stats.loc !== null && (
        <span className="stat" title="Lines of code (text files)">
          {formatCount(stats.loc)} LOC
        </span>
      )}
    </>
  );
}

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const repo = useReplay((s) => s.repo);
  const range = useReplay((s) => s.range);
  const pr = useReplay((s) => s.pr);
  const index = useReplay((s) => s.index);
  const hasWorkingTree = useReplay((s) => s.hasWorkingTree);
  const repoChanged = useReplay((s) => s.repoChanged);
  const refreshRepo = useReplay((s) => s.refreshRepo);
  const set = useReplay.setState;

  const sha = range ? frameSha(range, index, hasWorkingTree) : null;
  const baseLabel = range ? range.baseSha.slice(0, 7) : "";
  const headLabel = range ? range.headSha.slice(0, 7) : "";

  return (
    <header className="topbar">
      <button
        type="button"
        className="repo-chip"
        onClick={() => set({ range: null, pr: null })}
        title="Change replay range"
      >
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

      <div className="topbar-spacer" />

      {range && repo && sha && (
        <div className="repo-stats">
          <RepoStats sha={sha} repoId={repo.id} />
        </div>
      )}

      {range && <SearchBar />}

      <button
        type="button"
        className="btn-icon palette-trigger"
        onClick={onOpenPalette}
        title="Command palette (Ctrl+K)"
      >
        <span className="palette-trigger-label">{PALETTE_KEY_LABEL}</span>
      </button>

      {repoChanged && (
        <div className="repo-changed-banner" role="status">
          <span>Repository changed — new commits or branch switch detected.</span>
          <button type="button" className="btn btn-primary" onClick={() => void refreshRepo()}>
            <RefreshIcon size={13} /> Refresh
          </button>
          <button
            type="button"
            className="btn-icon"
            onClick={() => set({ repoChanged: false })}
            title="Dismiss"
            aria-label="Dismiss"
          >
            <span style={{ fontSize: 12 }}>✕</span>
          </button>
        </div>
      )}
    </header>
  );
}
