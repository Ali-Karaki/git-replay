// Configure what to replay: branch (merge-base aware), explicit commit
// range, or the entire repository (spec 9).

import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/ipc";
import { useReplay } from "../../stores/replay";
import { formatDateTime, shortSha } from "../../lib/format";
import type { CommitMeta } from "../../lib/types";
import { BranchIcon, TagIcon } from "../../components/Icons";
import { ErrorPanel } from "../../components/States";

type Mode = "branch" | "range" | "entire";

export function RangeSetup() {
  const repo = useReplay((s) => s.repo);
  const branches = useReplay((s) => s.branches);
  const tags = useReplay((s) => s.tags);
  const configureRange = useReplay((s) => s.configureRange);
  const busy = useReplay((s) => s.busy);
  const error = useReplay((s) => s.error);
  const errorDetail = useReplay((s) => s.errorDetail);
  const set = useReplay.setState;

  const [mode, setMode] = useState<Mode>("branch");
  const [base, setBase] = useState("");
  const [head, setHead] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [useMergeBase, setUseMergeBase] = useState(true);
  const [firstParent, setFirstParent] = useState(false);
  const [recent, setRecent] = useState<CommitMeta[]>([]);

  // Defaults: base = the repo's default branch, head = the checked-out branch.
  useEffect(() => {
    if (!repo) return;
    const defaultBranch = branches.find((b) => b.isHead)?.name ?? branches[0]?.name ?? "";
    const defaultBase = repo.defaultBranch && repo.defaultBranch !== defaultBranch ? repo.defaultBranch : defaultBranch;
    setBase(defaultBase);
    setHead(defaultBranch);
    api.getRecentCommits(repo.id, 200).then(setRecent).catch(() => undefined);
  }, [repo, branches]);

  const refOptions = useMemo(() => {
    const out: string[] = [];
    for (const b of branches) out.push(b.name);
    for (const t of tags) out.push(t.name);
    return out;
  }, [branches, tags]);

  const commitOptions = useMemo(
    () => recent.map((c) => `${c.sha.slice(0, 7)}  ${c.subject}  ${formatDateTime(c.commitTs)}`),
    [recent],
  );

  if (!repo) return null;

  const start = () => {
    if (mode === "branch") {
      void configureRange(base || null, head || null, useMergeBase, firstParent);
    } else if (mode === "range") {
      void configureRange(from || null, to || null, false, false);
    } else {
      // Entire repository: empty base resolves to the root commit.
      void configureRange("", null, false, firstParent);
    }
  };

  return (
    <div className="range-setup">
      <div className="range-card">
        <h1>Replay <span className="dim">{repo.path}</span></h1>

        <div className="range-modes" role="tablist">
          <button role="tab" aria-selected={mode === "branch"} className={`chip big ${mode === "branch" ? "on" : ""}`} onClick={() => setMode("branch")}>
            <BranchIcon size={13} /> Branch
          </button>
          <button role="tab" aria-selected={mode === "range"} className={`chip big ${mode === "range" ? "on" : ""}`} onClick={() => setMode("range")}>
            Commit range
          </button>
          <button role="tab" aria-selected={mode === "entire"} className={`chip big ${mode === "entire" ? "on" : ""}`} onClick={() => setMode("entire")}>
            Entire repository
          </button>
        </div>

        {mode === "branch" && (
          <div className="range-form">
            <label>
              Base
              <select value={base} onChange={(e) => setBase(e.target.value)}>
                <option value="">(none)</option>
                {refOptions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            <span className="range-arrow dim">→</span>
            <label>
              Head
              <select value={head} onChange={(e) => setHead(e.target.value)}>
                <option value="">(none)</option>
                {refOptions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={useMergeBase} onChange={(e) => setUseMergeBase(e.target.checked)} />
              Start at the merge base <span className="dim">(recommended — Frame 0 = where the branch diverged)</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={firstParent} onChange={(e) => setFirstParent(e.target.checked)} />
              First-parent only <span className="dim">(skip merged-in branches)</span>
            </label>
          </div>
        )}

        {mode === "range" && (
          <div className="range-form">
            <label>
              From
              <input list="range-commits" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="sha / branch / tag" />
            </label>
            <span className="range-arrow dim">→</span>
            <label>
              To
              <input list="range-commits" value={to} onChange={(e) => setTo(e.target.value)} placeholder="sha / branch / tag" />
            </label>
            <datalist id="range-commits">
              {commitOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <div className="dim range-hint">Any ref or SHA works — {shortSha(repo.headSha)} is HEAD.</div>
          </div>
        )}

        {mode === "entire" && (
          <div className="range-form">
            <label className="checkbox">
              <input type="checkbox" checked={firstParent} onChange={(e) => setFirstParent(e.target.checked)} />
              First-parent only
            </label>
            <div className="dim range-hint">Initial commit → HEAD. Large histories aggregate on the timeline.</div>
          </div>
        )}

        <div className="range-actions">
          <button className="btn btn-primary" onClick={start} disabled={busy}>
            {busy ? "Resolving…" : "Replay"}
          </button>
          <button className="btn" onClick={() => set({ repo: null, range: null, error: null, errorDetail: null })}>
            Open another repository
          </button>
          {tags.length > 0 && (
            <span className="dim range-tags">
              <TagIcon size={12} /> {tags.map((t) => t.name).join(", ")}
            </span>
          )}
        </div>

        {error && <ErrorPanel error={{ message: error, detail: errorDetail }} />}
      </div>
    </div>
  );
}
