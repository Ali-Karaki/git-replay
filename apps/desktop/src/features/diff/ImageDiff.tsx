// Image diffs (spec 11): when a changed file is binary and image-shaped, show
// the old and new versions side by side.

import { getFileAtCommit } from "../../lib/dataCaches";
import { useData } from "../../lib/useData";
import { formatBytes } from "../../lib/format";
import { ImageIcon } from "../../components/Icons";
import { Skeleton } from "../../components/States";

interface Side {
  label: string;
  file: { size: number; contentBase64: string | null; kind: string };
}

function ImageCard({ side }: { side: Side }) {
  if (side.file.contentBase64 === null) {
    return (
      <div className="image-card">
        <div className="image-card-label dim">{side.label}</div>
        <div className="image-missing dim">(no preview)</div>
      </div>
    );
  }
  return (
    <div className="image-card">
      <div className="image-card-label dim">{side.label} · {formatBytes(side.file.size)}</div>
      <img src={`data:image/*;base64,${side.file.contentBase64}`} alt={side.label} />
    </div>
  );
}

export function ImageDiff({ repoId, parentSha, commitSha, oldPath, newPath }: {
  repoId: number;
  parentSha: string | null;
  commitSha: string;
  oldPath: string | null;
  newPath: string | null;
}) {
  const old = useData(
    repoId && parentSha && oldPath ? `${repoId}|${parentSha}|${oldPath}` : null,
    () => getFileAtCommit(repoId!, parentSha!, oldPath!),
  );
  const cur = useData(
    repoId && newPath ? `${repoId}|${commitSha}|${newPath}` : null,
    () => getFileAtCommit(repoId!, commitSha, newPath!),
  );

  const loading = (parentSha && oldPath && (!old.data || old.loading)) || (!cur.data || cur.loading);
  if (loading) return <Skeleton rows={10} />;

  const sides: Side[] = [];
  if (parentSha && oldPath) {
    sides.push({ label: `Before — ${oldPath}`, file: old.data ?? { size: 0, contentBase64: null, kind: "binary" } });
  }
  if (newPath) {
    sides.push({ label: `After — ${newPath}`, file: cur.data ?? { size: 0, contentBase64: null, kind: "binary" } });
  }

  return (
    <div className="image-diff">
      <div className="image-diff-title dim">
        <ImageIcon size={13} /> Image change
      </div>
      <div className="image-diff-grid">
        {sides.map((s) => (
          <ImageCard key={s.label} side={s} />
        ))}
      </div>
    </div>
  );
}
