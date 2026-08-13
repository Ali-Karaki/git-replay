// The commit's identity block: subject, metadata, stats, parents (with merge
// parent selection), body, and "open externally".

import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { CommitDetail } from "../../lib/types";
import { formatCount, formatDateTime, shortSha } from "../../lib/format";
import { copyText } from "../../lib/clipboard";
import { api } from "../../lib/ipc";
import { useData } from "../../lib/useData";
import { useReplay } from "../../stores/replay";
import { BranchIcon, ChevronDown, ChevronRight, CopyIcon } from "../../components/Icons";

export function CommitHeader({ detail, commitNo }: { detail: CommitDetail; commitNo: number }) {
  const repo = useReplay((s) => s.repo);
  const mergeParent = useReplay((s) => s.mergeParent);
  const setMergeParent = useReplay((s) => s.setMergeParent);
  const [showBody, setShowBody] = useState(false);
  const meta = detail.meta;
  const isMerge = meta.parents.length > 1;

  const commitUrl = useData(
    repo && meta.sha !== "WORKTREE" ? `url|${repo.id}|${meta.sha}` : null,
    () => api.getCommitUrl(repo!.id, meta.sha),
  );

  const copySha = () => {
    void copyText(meta.sha);
  };

  return (
    <div className="commit-header">
      <div className="commit-header-top">
        <h2 className="commit-subject">
          <span className="commit-no">{commitNo}</span>
          {meta.subject}
        </h2>
        <div className="commit-meta">
          <span title={meta.author.email}>{meta.author.name}</span>
          <span className="dim">·</span>
          <span title={formatDateTime(meta.commitTs)}>{formatDateTime(meta.commitTs)}</span>
          <span className="dim">·</span>
          <button className="sha-chip" onClick={copySha} title="Copy commit SHA">
            {shortSha(meta.sha)} <CopyIcon size={11} />
          </button>
          {commitUrl.data && (
            <button className="sha-chip" onClick={() => void openUrl(commitUrl.data!)} title="Open commit on GitHub">
              ↗
            </button>
          )}
          {isMerge && (
            <span className="merge-badge" title={`Merge commit (${meta.parents.length} parents)`}>
              <BranchIcon size={12} /> merge
            </span>
          )}
        </div>
      </div>

      <div className="commit-stats">
        <span className="stat">{detail.stats.filesChanged} files</span>
        <span className="stat add">+{formatCount(detail.stats.insertions)}</span>
        <span className="stat del">−{formatCount(detail.stats.deletions)}</span>
      </div>

      {isMerge && (
        <div className="merge-parents" role="group" aria-label="Merge parent to compare against">
          {meta.parents.map((p, i) => (
            <button
              key={p}
              className={`chip ${mergeParent === i ? "on" : ""}`}
              onClick={() => setMergeParent(i)}
              title={`Compare against ${i === 0 ? "first" : i === 1 ? "second" : `${i + 1}th`} parent (${shortSha(p)})`}
            >
              {i === 0 ? "1st parent" : i === 1 ? "2nd parent" : `${i + 1}th parent`}
            </button>
          ))}
        </div>
      )}

      {meta.body && (
        <div className="commit-body">
          <button className="body-toggle" onClick={() => setShowBody(!showBody)}>
            {showBody ? <ChevronDown size={12} /> : <ChevronRight size={12} />} description
          </button>
          {showBody && <pre className="commit-body-text">{meta.body}</pre>}
        </div>
      )}
    </div>
  );
}
