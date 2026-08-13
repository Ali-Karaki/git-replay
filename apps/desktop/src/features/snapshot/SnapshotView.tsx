// Snapshot view: the whole repository as it existed after the current commit
// (spec 6.2 — a core feature, not a secondary one). New/modified/deleted
// markers come from the commit's own changes; the tree itself is
// content-addressed. The working-tree frame browses the index.

import { getCommitDetail } from "../../lib/dataCaches";
import { useData } from "../../lib/useData";
import { frameCommit, frameSha, useReplay } from "../../stores/replay";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";
import { Skeleton } from "../../components/States";

export function SnapshotView() {
  const repo = useReplay((s) => s.repo);
  const range = useReplay((s) => s.range);
  const index = useReplay((s) => s.index);
  const mergeParent = useReplay((s) => s.mergeParent);
  const hasWorkingTree = useReplay((s) => s.hasWorkingTree);
  const wtFrame = useReplay((s) => s.wtFrame);
  const commit = range && index > 0 ? frameCommit(range, index) : null;
  const isWtFrame = !!range && !!hasWorkingTree && index === range.commits.length + 1;
  const sha = range ? frameSha(range, index, hasWorkingTree) : null;

  // File changes drive the appeared/vanished markers; a base frame has none.
  const detail = useData(
    commit && repo && !isWtFrame ? `${repo.id}|${commit.sha}|${mergeParent}` : null,
    () => getCommitDetail(repo!.id, commit!.sha, commit!.parents.length > 1 ? mergeParent : null),
  );

  if (!repo || !range || !sha) return null;

  const changes = isWtFrame ? wtFrame?.files ?? [] : detail.data?.files ?? [];
  const title = index === 0
    ? "Repository at base"
    : isWtFrame
      ? "Repository in the working tree"
      : "Repository after this commit";

  return (
    <div className="view-snapshot">
      <div className="left-panel">
        <div className="panel-toolbar">
          <span className="panel-title">{title}</span>
        </div>
        {index > 0 && !isWtFrame && detail.loading && !detail.data ? (
          <Skeleton rows={8} />
        ) : (
          <FileTree changes={changes} />
        )}
      </div>
      <div className="main-panel">
        <FileViewer />
      </div>
    </div>
  );
}
