// Step view: what changed in this commit. Left = changed files, main = commit
// header + selected file's diff. Context is preserved across frames: the
// selected file stays selected when the next commit also touches it (spec 12).

import { useEffect } from "react";
import { getCommitDetail, getFileAtCommit, getFileDiff } from "../../lib/dataCaches";
import { useData } from "../../lib/useData";
import { frameSha, useReplay } from "../../stores/replay";
import { ChangedFiles } from "./ChangedFiles";
import { CommitHeader } from "./CommitHeader";
import { DiffView } from "../diff/DiffView";
import { ErrorPanel, Skeleton } from "../../components/States";

export function StepView() {
  const repo = useReplay((s) => s.repo);
  const range = useReplay((s) => s.range);
  const index = useReplay((s) => s.index);
  const mergeParent = useReplay((s) => s.mergeParent);
  const selectedFile = useReplay((s) => s.selectedFile);
  const setSelectedFile = useReplay((s) => s.setSelectedFile);

  const commit = range && index > 0 ? range.commits[index - 1] : null;
  const sha = range ? frameSha(range, index) : null;
  const detail = useData(
    commit && repo ? `${repo.id}|${commit.sha}|${mergeParent}` : null,
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
    repo && sha && selectedFile && detail.data ? `${repo.id}|${sha}|${mergeParent}|${selectedFile}` : null,
    () => getFileDiff(repo!.id, sha!, selectedFile!, detail.data!.meta.parents.length > 1 ? mergeParent : null),
  );

  if (!repo || !range || !sha) return null;

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
