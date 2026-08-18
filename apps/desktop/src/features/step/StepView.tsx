// Step view: what changed in this commit. Left = changed files, main = commit
// header + selected file's diff. Each frame opens the first changed file;
// File Evolution is the place to follow one path. The synthetic Working Tree
// frame (spec 35) reuses the same components.

import { useEffect, useMemo } from "react";
import { ErrorPanel, Skeleton } from "../../components/States";
import { getCommitDetail, getFileDiff } from "../../lib/dataCaches";
import { isLikelyImage } from "../../lib/format";
import { api } from "../../lib/ipc";
import type { CommitDetail } from "../../lib/types";
import { useData } from "../../lib/useData";
import { frameCommit, frameSha, useReplay } from "../../stores/replay";
import { DiffView } from "../diff/DiffView";
import { ImageDiff } from "../diff/ImageDiff";
import { ChangedFiles } from "./ChangedFiles";
import { CommitHeader } from "./CommitHeader";

export function StepView() {
  const repo = useReplay((s) => s.repo);
  const range = useReplay((s) => s.range);
  const hasWorkingTree = useReplay((s) => s.hasWorkingTree);
  const index = useReplay((s) => s.index);
  const mergeParent = useReplay((s) => s.mergeParent);
  const selectedFile = useReplay((s) => s.selectedFile);
  const setSelectedFile = useReplay((s) => s.setSelectedFile);

  const commit = range && index > 0 ? frameCommit(range, index) : null;
  const isWtFrame = !!range && !!hasWorkingTree && index === range.commits.length + 1;
  const sha = range ? frameSha(range, index, hasWorkingTree) : null;

  const detail = useData(commit && repo && !isWtFrame ? `${repo.id}|${commit.sha}|${mergeParent}` : null, () => {
    // The key guarantees repo and commit are set whenever the loader runs.
    if (!repo || !commit) throw new Error("unreachable: detail key requires repo and commit");
    return getCommitDetail(repo.id, commit.sha, commit.parents.length > 1 ? mergeParent : null);
  });

  // Every new frame opens the first changed file. `[` / `]` still cycle
  // within the commit because this effect keys off loaded detail, not selection.
  useEffect(() => {
    if (detail.loading || !detail.data) return;
    setSelectedFile(detail.data.files[0]?.newPath ?? null);
  }, [detail.loading, detail.data, setSelectedFile]);

  const fileDiff = useData(
    repo && sha && selectedFile && !isWtFrame && detail.data
      ? `${repo.id}|${sha}|${mergeParent}|${selectedFile}`
      : null,
    () => {
      // The key guarantees every value below is set whenever the loader runs.
      if (!repo || !sha || !selectedFile || !detail.data) {
        throw new Error("unreachable: file-diff key requires repo/sha/file/detail");
      }
      return getFileDiff(repo.id, sha, selectedFile, detail.data.meta.parents.length > 1 ? mergeParent : null);
    },
  );

  // Keep the selected file visible when navigating with ]/[ or the keyboard.
  // (Must stay above the conditional returns — Rules of Hooks.)
  useEffect(() => {
    // Both values are scroll triggers, not inputs to the DOM query.
    if (!selectedFile && index === 0) return;
    document.querySelector(".file-row.selected")?.scrollIntoView({ block: "nearest" });
  }, [selectedFile, index]);

  if (!repo || !range || !sha) return null;

  if (isWtFrame) {
    return <WorkingTreeStep sha={sha} />;
  }

  if (index === 0) {
    return (
      <div className="base-frame">
        <h2 className="commit-subject">Starting point</h2>
        <p className="dim">
          Base snapshot at <code>{sha.slice(0, 7)}</code>. Step forward to see the first change, or switch to Snapshot
          view to browse the project as it was here.
        </p>
      </div>
    );
  }

  const selectedChange = detail.data?.files.find((f) => f.newPath === selectedFile || f.oldPath === selectedFile);
  const parentSha = detail.data?.meta.parents[mergeParent] ?? null;

  return (
    <div className="view-step">
      <div className="left-panel">
        {detail.loading || !detail.data ? (
          <Skeleton rows={8} />
        ) : detail.error ? (
          <ErrorPanel error={detail.error} />
        ) : (
          <ChangedFiles detail={detail.data} />
        )}
      </div>
      <div className="main-panel">
        {detail.loading || !detail.data ? (
          <Skeleton rows={12} />
        ) : detail.error ? (
          <ErrorPanel error={detail.error} />
        ) : (
          <>
            <CommitHeader detail={detail.data} commitNo={index} />
            <div className="step-content" key={index}>
              {detail.data.files.length === 0 ? (
                <div className="empty-mini">No file changes in this commit.</div>
              ) : selectedFile === null || fileDiff.loading || !fileDiff.data ? (
                <Skeleton rows={14} />
              ) : fileDiff.error ? (
                <ErrorPanel error={fileDiff.error} />
              ) : fileDiff.data.binary && selectedChange && isLikelyImage(selectedChange.newPath) ? (
                <ImageDiff
                  repoId={repo.id}
                  parentSha={parentSha}
                  commitSha={sha}
                  oldPath={selectedChange.oldPath ?? selectedChange.newPath}
                  newPath={selectedChange.status === "deleted" ? null : selectedChange.newPath}
                />
              ) : (
                <DiffView
                  patch={fileDiff.data.patch}
                  oldPath={selectedChange?.oldPath}
                  newPath={selectedChange?.newPath}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The HEAD → working tree frame: same layout, working-tree data. */
function WorkingTreeStep({ sha }: { sha: string }) {
  const repo = useReplay((s) => s.repo);
  const range = useReplay((s) => s.range);
  const wtFrame = useReplay((s) => s.wtFrame);
  const selectedFile = useReplay((s) => s.selectedFile);
  const setSelectedFile = useReplay((s) => s.setSelectedFile);

  useEffect(() => {
    if (!wtFrame) return;
    setSelectedFile(wtFrame.files[0]?.newPath ?? null);
  }, [wtFrame, setSelectedFile]);

  const selectedChange = wtFrame?.files.find((f) => f.newPath === selectedFile || f.oldPath === selectedFile);
  const diff = useData(repo && selectedFile ? `${repo.id}|WORKTREE|${selectedFile}` : null, () => {
    // The key guarantees repo and selectedFile are set whenever the loader runs.
    if (!repo || !selectedFile) throw new Error("unreachable: working-tree diff key requires repo and file");
    return api.getWorkingFileDiff(repo.id, selectedFile);
  });

  const synthetic: CommitDetail | null = useMemo(() => {
    if (!wtFrame || !range) return null;
    return {
      meta: {
        sha: "WORKTREE",
        parents: [],
        author: { name: "", email: "" },
        committer: { name: "", email: "" },
        authorTs: 0,
        commitTs: Math.floor(Date.now() / 1000),
        subject: "Working Tree",
        body: wtFrame.untracked > 0 ? `${wtFrame.untracked} untracked file${wtFrame.untracked === 1 ? "" : "s"}` : "",
      },
      stats: wtFrame.stats,
      files: wtFrame.files,
    };
  }, [wtFrame, range]);

  if (!repo || !wtFrame || !synthetic) {
    return (
      <div className="view-step">
        <Skeleton rows={10} />
      </div>
    );
  }

  return (
    <div className="view-step">
      <div className="left-panel">
        <ChangedFiles detail={synthetic} />
      </div>
      <div className="main-panel">
        <div className="commit-header">
          <div className="commit-header-top">
            <h2 className="commit-subject">
              <span className="commit-no wt">WT</span>
              Working Tree
            </h2>
            <div className="commit-meta">
              <span>uncommitted changes</span>
              <span className="dim">·</span>
              <span className="add">staged + unstaged vs HEAD ({sha.slice(0, 7)})</span>
            </div>
          </div>
          <div className="commit-stats">
            <span className="stat">{wtFrame.stats.filesChanged} files</span>
            <span className="stat add">+{wtFrame.stats.insertions}</span>
            <span className="stat del">−{wtFrame.stats.deletions}</span>
            {wtFrame.untracked > 0 && <span className="stat">+{wtFrame.untracked} untracked</span>}
          </div>
        </div>
        <div className="step-content">
          {wtFrame.files.length === 0 ? (
            <div className="empty-mini">The working tree is clean.</div>
          ) : selectedFile === null || diff.loading || !diff.data ? (
            <Skeleton rows={14} />
          ) : diff.error ? (
            <ErrorPanel error={diff.error} />
          ) : diff.data.binary && selectedChange && isLikelyImage(selectedChange.newPath) ? (
            <ImageDiff
              repoId={repo.id}
              parentSha={sha}
              commitSha="WORKTREE"
              oldPath={selectedChange.oldPath ?? selectedChange.newPath}
              newPath={selectedChange.status === "deleted" ? null : selectedChange.newPath}
            />
          ) : (
            <DiffView patch={diff.data.patch} oldPath={selectedChange?.oldPath} newPath={selectedChange?.newPath} />
          )}
        </div>
      </div>
    </div>
  );
}
