// Snapshot view: the whole repository as it existed after the current commit
// (spec 6.2 — a core feature, not a secondary one). New/modified/deleted
// markers come from the commit's own changes; the tree itself is
// content-addressed.

import { getCommitDetail } from "../../lib/dataCaches";
import { useData } from "../../lib/useData";
import { frameSha, useReplay } from "../../stores/replay";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";
import { Skeleton } from "../../components/States";

export function SnapshotView() {
  const repo = useReplay((s) => s.repo);
  const range = useReplay((s) => s.range);
  const index = useReplay((s) => s.index);
  const mergeParent = useReplay((s) => s.mergeParent);
  const commit = range && index > 0 ? range.commits[index - 1] : null;
  const sha = range ? frameSha(range, index) : null;

  // File changes drive the appeared/vanished markers; a base frame has none.
  const detail = useData(
    commit && repo ? `${repo.id}|${commit.sha}|${mergeParent}` : null,
    () => getCommitDetail(repo!.id, commit!.sha, commit!.parents.length > 1 ? mergeParent : null),
  );

  if (!repo || !range || !sha) return null;

  return (
    <div className="view-snapshot">
      <div className="left-panel">
        <div className="panel-toolbar">
          <span className="panel-title">{index === 0 ? "Repository at base" : "Repository after this commit"}</span>
        </div>
        {index > 0 && detail.loading && !detail.data ? (
          <Skeleton rows={8} />
        ) : (
          <FileTree changes={detail.data?.files ?? []} />
        )}
      </div>
      <div className="main-panel">
        <FileViewer />
      </div>
    </div>
  );
}
