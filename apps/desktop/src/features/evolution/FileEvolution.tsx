// File evolution: every commit in the replay that touched the selected file,
// with rename continuity (the engine follows git's rename chain). Feels like
// watching the file grow — with file-only playback and prev/next navigation.

import { useEffect, useState } from "react";
import { EvolutionIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from "../../components/Icons";
import { ErrorPanel, Skeleton } from "../../components/States";
import { getCommitDetail, getFileDiff } from "../../lib/dataCaches";
import { formatCount, formatDateTime, shortSha, statusLabel } from "../../lib/format";
import { api } from "../../lib/ipc";
import { useData } from "../../lib/useData";
import { useReplay } from "../../stores/replay";
import { DiffView } from "../diff/DiffView";

export function FileEvolution() {
  const repo = useReplay((s) => s.repo);
  const range = useReplay((s) => s.range);
  const selectedFile = useReplay((s) => s.selectedFile);
  const setIndex = useReplay((s) => s.setIndex);
  const mergeParent = useReplay((s) => s.mergeParent);

  const evolution = useData(
    repo && range && selectedFile ? `${repo.id}|${range.baseSha}|${range.headSha}|${selectedFile}` : null,
    () => {
      // The key guarantees repo, range, and selectedFile are set whenever the loader runs.
      if (!repo || !range || !selectedFile) throw new Error("unreachable: evolution key requires repo/range/file");
      return api.getFileEvolution(repo.id, range.baseSha, range.headSha, selectedFile);
    },
  );

  // Index (within the evolution entries) of the entry currently being shown.
  const [entryIdx, setEntryIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  // Keep entryIdx valid as data changes.
  useEffect(() => {
    if (evolution.data && entryIdx === null && evolution.data.length > 0) {
      setEntryIdx(evolution.data.length - 1); // latest first
    }
  }, [evolution.data, entryIdx]);

  // File-only playback. `entryIdx` re-arms the timer per step, matching the
  // main transport's manual-step-wins behavior.
  useEffect(() => {
    if (!playing || !evolution.data) return;
    const timer = window.setTimeout(() => {
      if (entryIdx === null) return;
      const next = entryIdx - 1;
      if (next < 0) {
        setPlaying(false);
        setEntryIdx(0);
      } else {
        setEntryIdx(next);
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [playing, entryIdx, evolution.data]);

  if (!repo || !range) return null;
  if (!selectedFile) {
    return (
      <div className="view-evolution">
        <div className="empty-mini">
          Select a file (from Snapshot view or the changed files) to follow its evolution.
        </div>
      </div>
    );
  }

  if (evolution.loading && !evolution.data) return <Skeleton rows={10} />;
  if (evolution.error) return <ErrorPanel error={evolution.error} />;
  if (!evolution.data || evolution.data.length === 0) {
    return <div className="empty-mini">This file never changed within the replay range.</div>;
  }

  const entries = evolution.data; // oldest → newest
  const current = entryIdx !== null ? entries[entryIdx] : entries[entries.length - 1];
  const shaIndex = range.commits.findIndex((c) => c.sha === current.sha);
  const frameNo = shaIndex + 1;

  return (
    <div className="view-evolution">
      <div className="left-panel">
        <div className="panel-toolbar">
          <span className="panel-title">
            <EvolutionIcon size={13} /> {selectedFile}
          </span>
        </div>
        <div className="panel-toolbar slim">
          <button type="button" className="chip" onClick={() => setPlaying(!playing)}>
            {playing ? <PauseIcon size={12} /> : <PlayIcon size={12} />} {playing ? "pause" : "play file"}
          </button>
          <button
            type="button"
            className="btn-icon"
            disabled={entryIdx === null || entryIdx <= 0}
            onClick={() => setEntryIdx((i) => (i === null ? 0 : i - 1))}
            title="Previous change"
          >
            <PrevIcon size={13} />
          </button>
          <button
            type="button"
            className="btn-icon"
            disabled={entryIdx === null || entryIdx >= entries.length - 1}
            onClick={() => setEntryIdx((i) => (i === null ? entries.length - 1 : i + 1))}
            title="Next change"
          >
            <NextIcon size={13} />
          </button>
        </div>
        <div className="file-list">
          {entries
            .map((e, i) => ({ e, i }))
            .reverse()
            .map(({ e, i }) => (
              <button
                type="button"
                key={e.sha + e.newPath}
                className={`file-row ${i === entryIdx ? "selected" : ""}`}
                onClick={() => setEntryIdx(i)}
              >
                <span className={`status-dot status-${e.status}`} />
                <span className="file-row-name">
                  <span className="dim">{shortSha(e.sha)}</span> {e.subject}
                </span>
                <span className="file-row-stats">
                  {e.additions > 0 && <span className="add">+{formatCount(e.additions)}</span>}
                  {e.deletions > 0 && <span className="del">−{formatCount(e.deletions)}</span>}
                </span>
              </button>
            ))}
        </div>
      </div>
      <div className="main-panel">
        <EvolutionDetail
          key={current.sha + current.newPath}
          entry={current}
          frameNo={frameNo}
          onJump={() => setIndex(frameNo)}
          mergeParent={mergeParent}
        />
      </div>
    </div>
  );
}

function EvolutionDetail({
  entry,
  frameNo,
  onJump,
  mergeParent,
}: {
  entry: {
    sha: string;
    subject: string;
    commitTs: number;
    status: string;
    oldPath: string | null;
    newPath: string;
    additions: number;
    deletions: number;
    similarity: number | null;
  };
  frameNo: number;
  onJump: () => void;
  mergeParent: number;
}) {
  const repo = useReplay((s) => s.repo);
  const detail = useData(repo ? `${repo.id}|${entry.sha}|${mergeParent}` : null, () => {
    // The key guarantees repo is set whenever the loader runs.
    if (!repo) throw new Error("unreachable: evolution detail key requires a repo");
    return getCommitDetail(repo.id, entry.sha, mergeParent);
  });
  const change = detail.data?.files.find((f) => f.newPath === entry.newPath || f.oldPath === entry.oldPath);
  const diff = useData(repo && change ? `${repo.id}|${entry.sha}|${mergeParent}|${change.newPath}` : null, () => {
    // The key guarantees repo, change, and detail are set whenever the loader runs.
    if (!repo || !change || !detail.data)
      throw new Error("unreachable: evolution diff key requires repo/change/detail");
    return getFileDiff(repo.id, entry.sha, change.newPath, detail.data.meta.parents.length > 1 ? mergeParent : null);
  });

  const statusText =
    entry.status === "renamed" || entry.status === "copied"
      ? `${statusLabel(entry.status)}${entry.similarity !== null ? ` · ${entry.similarity}% similar` : ""}`
      : statusLabel(entry.status);
  const pathText = entry.oldPath ? `${entry.oldPath} → ${entry.newPath}` : entry.newPath;

  return (
    <div className="evolution-detail">
      <div className="commit-header">
        <div className="commit-header-top">
          <h2 className="commit-subject">
            <button type="button" className="commit-no jump" onClick={onJump} title="Jump to this commit in the replay">
              {frameNo}
            </button>
            {entry.subject}
          </h2>
          <div className="commit-meta">
            <span>{formatDateTime(entry.commitTs)}</span>
            <span className="dim">·</span>
            <span>{statusText}</span>
            <span className="dim">·</span>
            <span className="add">+{formatCount(entry.additions)}</span>
            <span className="del">−{formatCount(entry.deletions)}</span>
          </div>
        </div>
      </div>
      <div className="step-content">
        <div className="evolution-path">{pathText}</div>
        {diff.loading || !diff.data ? (
          <Skeleton rows={12} />
        ) : diff.error ? (
          <ErrorPanel error={diff.error} />
        ) : (
          <DiffView patch={diff.data.patch} oldPath={entry.oldPath} newPath={entry.newPath} />
        )}
      </div>
    </div>
  );
}
