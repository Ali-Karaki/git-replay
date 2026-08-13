// Prefetch adjacent commit details so stepping feels instantaneous
// (invariant 7). Cached promises make repeat mounts free.

import { useEffect } from "react";
import { prefetchCommit } from "../lib/dataCaches";
import { useReplay } from "../stores/replay";

const RADIUS = 3;

export function usePrefetch() {
  const repo = useReplay((s) => s.repo);
  const range = useReplay((s) => s.range);
  const index = useReplay((s) => s.index);
  const mergeParent = useReplay((s) => s.mergeParent);

  useEffect(() => {
    if (!repo || !range) return;
    for (let d = -RADIUS; d <= RADIUS; d++) {
      const target = index + d;
      if (target < 0 || target > range.commits.length) continue;
      if (target === 0) continue; // base frame has no detail
      const sha = range.commits[target - 1].sha;
      prefetchCommit(repo.id, sha, mergeParent);
    }
  }, [repo, range, index, mergeParent]);
}
