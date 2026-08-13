// Configure what to replay: branch (merge-base aware), commit range, tags /
// releases, a GitHub pull request (with force-push versions), or the entire
// repository (spec 9).

import { useEffect, useMemo, useState } from "react";
import { BranchIcon, ClockIcon, FolderOpenIcon, PrIcon, SwapIcon, TagIcon } from "../../components/Icons";
import { ErrorPanel } from "../../components/States";
import { formatDateTime, shortSha } from "../../lib/format";
import { api } from "../../lib/ipc";
import type { CommitMeta, PrReplay } from "../../lib/types";
import { useReplay } from "../../stores/replay";

type Mode = "branch" | "range" | "tags" | "pr" | "entire";

interface ModeCard {
  id: Mode;
  icon: (p: { size?: number }) => React.ReactNode;
  title: string;
  desc: string;
  /** Span the full card row (used for the last, most general option). */
  wide?: boolean;
}

const MODE_CARDS: ModeCard[] = [
  {
    id: "branch",
    icon: BranchIcon,
    title: "Watch a branch",
    desc: "See how a branch grew — where it started to where it is now",
  },
  {
    id: "range",
    icon: SwapIcon,
    title: "Watch a range of commits",
    desc: "Pick any start and end — commits, tags, or SHAs",
  },
  {
    id: "tags",
    icon: TagIcon,
    title: "Watch between releases",
    desc: "How the project changed from one tag to the next",
  },
  {
    id: "pr",
    icon: PrIcon,
    title: "Watch a pull request",
    desc: "Replay a GitHub PR, including its force-push history",
  },
  {
    id: "entire",
    icon: FolderOpenIcon,
    title: "Watch everything",
    desc: "The full story — initial commit to HEAD",
    wide: true,
  },
];

/** The mode that actually yields a replay for the given repo shape: a
 *  branch-to-branch replay only makes sense when base and head differ. */
export function suggestInitialMode(defaultBranch: string | null, headBranch: string): "branch" | "entire" {
  if (!headBranch) return "entire";
  if (defaultBranch && defaultBranch !== headBranch) return "branch";
  return "entire";
}

export function RangeSetup() {
  const repo = useReplay((s) => s.repo);
  const branches = useReplay((s) => s.branches);
  const tags = useReplay((s) => s.tags);
  const configureRange = useReplay((s) => s.configureRange);
  const resolvePr = useReplay((s) => s.resolvePr);
  const busy = useReplay((s) => s.busy);
  const error = useReplay((s) => s.error);
  const errorDetail = useReplay((s) => s.errorDetail);
  const set = useReplay.setState;

  const [mode, setMode] = useState<Mode>("branch");
  const [base, setBase] = useState("");
  const [head, setHead] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fromTag, setFromTag] = useState("");
  const [toTag, setToTag] = useState("");
  const [useMergeBase, setUseMergeBase] = useState(true);
  const [firstParent, setFirstParent] = useState(false);
  const [recent, setRecent] = useState<CommitMeta[]>([]);
  // PR mode state.
  const [prInput, setPrInput] = useState("");
  const [prMeta, setPrMeta] = useState<PrReplay | null>(null);
  const [prVersion, setPrVersion] = useState<string | null>(null);
  const [prError, setPrError] = useState<string | null>(null);

  // Defaults: base = the repo's default branch, head = the checked-out branch.
  // When both are the same (e.g. a single-branch repo like this one), a
  // branch replay would be empty — default to the entire repository instead.
  useEffect(() => {
    if (!repo) return;
    const defaultBranch = branches.find((b) => b.isHead)?.name ?? branches[0]?.name ?? "";
    const defaultBase = repo.defaultBranch && repo.defaultBranch !== defaultBranch ? repo.defaultBranch : defaultBranch;
    setBase(defaultBase);
    setHead(defaultBranch);
    setMode(suggestInitialMode(repo.defaultBranch, defaultBranch));
    if (tags.length >= 2) {
      setFromTag(tags[0].name);
      setToTag(tags[tags.length - 1].name);
    }
    api
      .getRecentCommits(repo.id, 200)
      .then(setRecent)
      .catch(() => undefined);
  }, [repo, branches, tags]);

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

  // Plain-language preview of what the engine will resolve — the empty-ref
  // fallbacks mirror resolve_replay in history.rs exactly (merge-base of
  // HEAD, HEAD itself, or the root commit), never a guessed branch.
  const summary = (() => {
    if (mode === "branch") {
      const h = head || "HEAD";
      const b = base || (useMergeBase ? `the merge base of HEAD and ${h}` : "HEAD");
      return `Will replay: ${b} → ${h}${useMergeBase && base ? " (from the merge base)" : ""}`;
    }
    if (mode === "range") {
      return `Will replay: from ${from || "the root commit"} to ${to || "HEAD"}`;
    }
    if (mode === "tags") {
      if (!fromTag || !toTag) return "";
      return `Will replay: from ${fromTag} to ${toTag}`;
    }
    if (mode === "pr") {
      return prMeta ? `${prMeta.title} — ${prMeta.range.commits.length} commits` : "";
    }
    return `Will replay: every commit from the root to ${branches.find((b) => b.isHead)?.name ?? "HEAD"}`;
  })();

  const start = () => {
    set({ error: null, errorDetail: null });
    if (mode === "branch") {
      void configureRange(base || null, head || null, useMergeBase, firstParent);
    } else if (mode === "range") {
      void configureRange(from || null, to || null, false, false);
    } else if (mode === "tags") {
      void configureRange(fromTag || null, toTag || null, false, false);
    } else if (mode === "pr") {
      void resolvePr(prInput, prVersion);
    } else {
      // Entire repository: empty base resolves to the root commit.
      void configureRange("", null, false, firstParent);
    }
  };

  const loadPr = async () => {
    setPrError(null);
    setPrMeta(null);
    setPrVersion(null);
    if (!prInput.trim()) return;
    try {
      const pr = await api.resolvePrReplay(repo.id, prInput.trim(), null);
      setPrMeta(pr);
      setPrVersion(null);
    } catch (e) {
      const err = e as { message?: string; detail?: string | null };
      setPrError(err.message ?? String(e));
    }
  };

  return (
    <div className="range-setup">
      <div className="range-card">
        <h1>
          Replay <span className="dim">{repo.path}</span>
        </h1>

        <div className="range-mode-cards" role="tablist">
          {MODE_CARDS.map((m) => (
            <button
              type="button"
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              className={`range-mode-card ${mode === m.id ? "active" : ""} ${m.wide ? "wide" : ""}`}
              onClick={() => setMode(m.id)}
            >
              <span className="range-mode-icon">
                <m.icon size={16} />
              </span>
              <span>
                <span className="range-mode-title">{m.title}</span>
                <span className="range-mode-desc">{m.desc}</span>
              </span>
            </button>
          ))}
        </div>

        {mode === "branch" && (
          <div className="range-form">
            <label>
              From
              <select value={base} onChange={(e) => setBase(e.target.value)}>
                <option value="">(none)</option>
                {refOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <span className="range-arrow dim">→</span>
            <label>
              To
              <select value={head} onChange={(e) => setHead(e.target.value)}>
                <option value="">(none)</option>
                {refOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <details className="range-more">
              <summary>More options</summary>
              <label className="checkbox">
                <input type="checkbox" checked={useMergeBase} onChange={(e) => setUseMergeBase(e.target.checked)} />
                Start at the merge base <span className="dim">(recommended — Frame 0 = where the branch diverged)</span>
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={firstParent} onChange={(e) => setFirstParent(e.target.checked)} />
                First-parent only <span className="dim">(skip merged-in branches)</span>
              </label>
            </details>
            {base && base === head && (
              <div className="range-hint warn">
                From and To are the same branch — this replay would be empty. Pick a different branch, open{" "}
                <strong>More options</strong> and turn off “start at the merge base”, or use Watch everything.
              </div>
            )}
          </div>
        )}

        {mode === "range" && (
          <div className="range-form">
            <label>
              From
              <input
                list="range-commits"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="sha / branch / tag"
              />
            </label>
            <span className="range-arrow dim">→</span>
            <label>
              To
              <input
                list="range-commits"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="sha / branch / tag"
              />
            </label>
            <datalist id="range-commits">
              {commitOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <div className="dim range-hint">Any ref or SHA works — {shortSha(repo.headSha)} is HEAD.</div>
          </div>
        )}

        {mode === "tags" && (
          <div className="range-form">
            {tags.length === 0 ? (
              <div className="dim range-hint">This repository has no tags yet.</div>
            ) : (
              <>
                <label>
                  From
                  <select value={fromTag} onChange={(e) => setFromTag(e.target.value)}>
                    {tags.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="range-arrow dim">→</span>
                <label>
                  To
                  <select value={toTag} onChange={(e) => setToTag(e.target.value)}>
                    {tags.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="dim range-hint">See how the project evolved between releases.</div>
              </>
            )}
          </div>
        )}

        {mode === "pr" && (
          <div className="range-form pr-form">
            <label>
              Pull request
              <input
                value={prInput}
                onChange={(e) => setPrInput(e.target.value)}
                placeholder="#482 or https://github.com/org/repo/pull/482"
                onKeyDown={(e) => e.key === "Enter" && void loadPr()}
              />
            </label>
            <button type="button" className="btn" onClick={() => void loadPr()} disabled={busy || !prInput.trim()}>
              Load
            </button>
            {prMeta && (
              <>
                <div className="pr-meta">
                  <span className="pr-title">{prMeta.title}</span>
                  <span className="dim">
                    base {shortSha(prMeta.range.baseSha)} · head {shortSha(prMeta.range.headSha)} ·{" "}
                    {prMeta.range.commits.length} commits
                  </span>
                </div>
                {prMeta.versions.length > 1 && (
                  <label className="pr-versions">
                    Version
                    <select value={prVersion ?? ""} onChange={(e) => setPrVersion(e.target.value || null)}>
                      {prMeta.versions.map((v) => (
                        <option key={v.number} value={v.afterSha}>
                          {v.number === prMeta.versions.length ? "Current" : `Force-push ${v.number}`}
                          {v.number !== prMeta.versions.length ? ` · ${shortSha(v.afterSha)}` : ""}
                          {v.createdAt ? ` · ${formatDateTime(v.createdAt)}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            {prError && <div className="range-error">{prError}</div>}
            <div className="dim range-hint">
              Uses the <code>gh</code> CLI when available (private repos + force-push history); public repos work via
              git fetch alone.
            </div>
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

        {summary && <div className="range-summary">{summary}</div>}

        <div className="range-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={start}
            disabled={busy || (mode === "pr" && !prMeta)}
          >
            {busy ? "Resolving…" : "Start watching"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => set({ repo: null, range: null, error: null, errorDetail: null })}
          >
            Open another repository
          </button>
          {tags.length > 0 && mode !== "tags" && (
            <span className="dim range-tags">
              <TagIcon size={12} />{" "}
              {tags
                .slice(0, 8)
                .map((t) => t.name)
                .join(", ")}
              {tags.length > 8 ? "…" : ""}
            </span>
          )}
          {mode === "branch" && (
            <span className="dim range-tags">
              <ClockIcon size={12} /> Playback: manual steps always work; Space plays
            </span>
          )}
        </div>

        {error && <ErrorPanel error={{ message: error, detail: errorDetail }} />}
      </div>
    </div>
  );
}
