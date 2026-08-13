// Replay-aware search: commit messages and touched paths within the current
// range. Results jump the playhead (spec 22: search understands history, not
// just the final state).

import { useEffect, useRef, useState } from "react";
import { SearchIcon } from "../../components/Icons";
import { formatDateTime, shortSha } from "../../lib/format";
import { api } from "../../lib/ipc";
import type { SearchResult } from "../../lib/types";
import { useReplay } from "../../stores/replay";

export function SearchBar() {
  const repo = useReplay((s) => s.repo);
  const range = useReplay((s) => s.range);
  const setIndex = useReplay((s) => s.setIndex);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    // `range` is the reset trigger (a new replay clears the search).
    if (range) {
      setQuery("");
      setResults([]);
      setOpen(false);
    }
  }, [range]);

  useEffect(() => {
    if (!repo || !range || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const id = ++seq.current;
    const timer = window.setTimeout(() => {
      api
        .searchReplay(repo.id, range.baseSha, range.headSha, query, 30)
        .then((r) => {
          if (seq.current === id) {
            setResults(r);
            setSelected(0);
            setOpen(true);
          }
        })
        .catch(() => undefined); // mid-transition rejections are not user-facing
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, repo, range]);

  const jump = (r: SearchResult) => {
    const idx = range?.commits.findIndex((c) => c.sha === r.sha) ?? -1;
    if (idx >= 0) setIndex(idx + 1);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      jump(results[selected]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="search">
      <SearchIcon size={13} />
      <input
        ref={inputRef}
        className="search-input"
        placeholder="Search commits & files  (/)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && results.length > 0 && (
        <div className="search-results">
          {results.map((r, i) => (
            <button
              type="button"
              key={r.sha}
              className={`search-result ${i === selected ? "selected" : ""}`}
              onClick={() => jump(r)}
            >
              <span className="dim">{shortSha(r.sha)}</span>
              <span className="search-result-subject">{r.subject}</span>
              <span
                className="search-kind"
                title={`Matched by ${r.kind === "content" ? "changed content (pickaxe)" : r.kind}`}
              >
                {r.kind}
              </span>
              <span className="dim">{formatDateTime(r.commitTs)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function focusSearch() {
  document.querySelector<HTMLInputElement>(".search-input")?.focus();
}
