// Playback clock: advances frames on a timer while playing. Manual stepping
// always wins — any index change resets the timer (index is a dependency,
// so each step re-arms it).
//
// Adaptive mode (spec 8) sizes the dwell time from the commit's stats when
// they're already cached: a tiny commit flashes by, a substantial one pauses.
// With nothing cached it falls back to the fixed rate.

import { useEffect } from "react";
import { getCachedCommitDetail } from "../lib/dataCaches";
import { frameCount, useReplay } from "../stores/replay";

const BASE_MS = 900;
const ADAPTIVE_MIN = 350;
const ADAPTIVE_MAX = 4000;

export function usePlayback() {
  const playing = useReplay((s) => s.playing);
  const speed = useReplay((s) => s.speed);
  const index = useReplay((s) => s.index);
  const adaptive = useReplay((s) => s.adaptivePlayback);
  const range = useReplay((s) => s.range);
  const repo = useReplay((s) => s.repo);
  const mergeParent = useReplay((s) => s.mergeParent);
  const hasWorkingTree = useReplay((s) => s.hasWorkingTree);
  const setPlaying = useReplay((s) => s.setPlaying);
  const setIndex = useReplay((s) => s.setIndex);

  useEffect(() => {
    if (!playing) return;
    let delay = BASE_MS / speed;
    if (adaptive && range && repo && index > 0 && index <= range.commits.length) {
      const commit = range.commits[index - 1];
      const detail = getCachedCommitDetail(repo.id, commit.sha, mergeParent);
      if (detail) {
        const size = detail.stats.filesChanged * 6 + detail.stats.insertions + detail.stats.deletions;
        delay = Math.min(ADAPTIVE_MAX, Math.max(ADAPTIVE_MIN, 250 + size * 3.5)) / speed;
      }
    }
    const timer = window.setTimeout(() => {
      if (!range) return;
      if (index >= frameCount(range, hasWorkingTree) - 1) {
        setPlaying(false); // end of the replay
      } else {
        setIndex(index + 1);
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [playing, speed, index, adaptive, range, repo, mergeParent, hasWorkingTree, setPlaying, setIndex]);
}
