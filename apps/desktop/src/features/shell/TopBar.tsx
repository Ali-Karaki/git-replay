// App header: repo + range summary, view switcher, search, repo stats,
// panel collapse, refresh banner.

import { useEffect, useState } from "react";
import { api } from "../../lib/ipc";
import { formatCount } from "../../lib/format";
import { frameSha, useReplay, type ViewMode } from "../../stores/replay";
import { SearchBar } from "../search/SearchBar";
import { useChat } from "../../stores/chat";
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
  const chatOpen = useChat((s) => s.open);

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

      <button
        className={`btn-icon chat-trigger ${chatOpen ? "active" : ""}`}
        onClick={() => useChat.setState({ open: !chatOpen })}
        title="Ask about this replay (AI chat, opt-in)"
        aria-label="AI chat"
      >
        <ChatIcon size={15} />
      </button>

      <button className="btn-icon" onClick={() => set({ screen: "settings" })} title="Settings" aria-label="Settings">
        <GearIcon size={15} />
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

function ChatIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12.5c3.5-4 5-4 8-6 1.8-1.2 3.4-1.6 4-1.5-.4 3.3-2.7 7.5-6 8-2.6.4-4.3-1.8-6-.5z" />
      <path d="M6 12.5c-.2-1.2.1-2.4 1-3.3" />
    </svg>
  );
}

function GearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1" />
    </svg>
  );
}
