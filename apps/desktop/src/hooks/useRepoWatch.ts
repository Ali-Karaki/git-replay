// Repository-change detection (spec 34): lightweight HEAD polling while the
// window is visible — a new commit, branch switch, or dirty state raises a
// "repository changed" banner instead of silently drifting.

import { useEffect } from "react";
import { api } from "../lib/ipc";
import { useReplay } from "../stores/replay";

const POLL_MS = 4000;

export function useRepoWatch() {
  const repo = useReplay((s) => s.repo);
  const range = useReplay((s) => s.range);

  useEffect(() => {
    if (!repo || !range) return;
    let cancelled = false;
    const check = async () => {
      if (document.hidden) return;
      try {
        const hs = await api.getHeadState(repo.id);
        if (cancelled) return;
        const s = useReplay.getState();
        if (!s.headState) return;
        if (hs.sha !== s.headState.sha || hs.branch !== s.headState.branch) {
          useReplay.setState({ repoChanged: true });
        }
      } catch {
        // Transient failures (e.g. mid-operation) are not user-facing.
      }
    };
    const timer = window.setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [repo, range]);
}
