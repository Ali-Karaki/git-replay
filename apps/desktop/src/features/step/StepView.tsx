// Step view: what changed in this commit. Left = changed files, main = commit
// header + selected file's diff. Context is preserved across frames: the
// selected file stays selected when the next commit also touches it (spec 12).
// The synthetic Working Tree frame (spec 35) reuses the same components.

import { useEffect, useMemo } from "react";
import { getCommitDetail, getFileAtCommit, getFileDiff } from "../../lib/dataCaches";
import { useData } from "../../lib/useData";
import { api } from "../../lib/ipc";
import { frameCommit, frameSha, useReplay } from "../../stores/replay";
import type { CommitDetail } from "../../lib/types";
import { ChangedFiles } from "./ChangedFiles";
import { CommitHeader } from "./CommitHeader";
import { DiffView } from "../diff/DiffView";
import { ImageDiff } from "../diff/ImageDiff";
import { isLikelyImage } from "../../lib/format";
import { ErrorPanel, Skeleton } from "../../components/States";

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

  const detail = useData(
    commit && repo && !isWtFrame ? `${repo.id}|${commit.sha}|${mergeParent}` : null,
    () => getCommitDetail(repo!.id, commit!.sha, commit!.parents.length > 1 ? mergeParent : null),
  );

  // Preserve the selected file across frames (spec 12): keep it when this
  // commit touches it; otherwise verify it still exists at this frame and
  // clear the selection only when it's gone.
  useEffect(() => {
    if (!detail.data || !selectedFile || !repo || !sha) return;
    const touched = detail.data.files.some((f) => f.newPath === selectedFile || f.oldPath === selectedFile);
    if (touched) return;
    let cancelled = false;
    getFileAtCommit(repo.id, sha, selectedFile).catch(() => {
      if (!cancelled) setSelectedFile(null);
    });
    return () => {
      cancelled = true;
    };
  }, [detail.data, selectedFile, repo, sha, setSelectedFile]);

  const fileDiff = useData(
    repo && sha && selectedFile && !isWtFrame && detail.data ? `${repo.id}|${sha}|${mergeParent}|${selectedFile}` : null,
    () => getFileDiff(repo!.id, sha!, selectedFile!, detail.data!.meta.parents.length > 1 ? mergeParent : null),
  );

  if (!repo || !range || !sha) return null;

  if (isWtFrame) {
    return <WorkingTreeStep sha={sha} />;
  }

  if (index === 0) {
    return (
      <div className="base-frame">
        <h2 className="commit-subject">Starting point</h2>
        <p className="dim">
          Base snapshot at <code>{sha.slice(0, 7)}</code>. Step forward to see the first change, or switch to
          Snapshot view to browse the project as it was here.
        </p>
      </div>
    );
  }

  const selectedChange = detail.data?.files.find(
    (f) => f.newPath === selectedFile || f.oldPath === selectedFile,
  );
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
            <div className="step-content">
              {selectedFile === null ? (
                <div className="empty-mini">Select a file to see its changes.</div>
              ) : fileDiff.loading || !fileDiff.data ? (
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
  const selectedChange = wtFrame?.files.find(
    (f) => f.newPath === selectedFile || f.oldPath === selectedFile,
  );
  const diff = useData(
    repo && selectedFile ? `${repo.id}|WORKTREE|${selectedFile}` : null,
    () => api.getWorkingFileDiff(repo!.id, selectedFile!),
  );

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
          {selectedFile === null ? (
            <div className="empty-mini">
              {wtFrame.files.length === 0 ? "The working tree is clean." : "Select a file to see its changes."}
            </div>
          ) : diff.loading || !diff.data ? (
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
