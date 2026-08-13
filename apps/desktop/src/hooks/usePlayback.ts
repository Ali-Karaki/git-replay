// Playback clock: advances frames on a timer while playing. Manual stepping
// always wins — any index change resets the timer.

import { useEffect } from "react";
import { useReplay } from "../stores/replay";

const BASE_MS = 900;

export function usePlayback() {
  const playing = useReplay((s) => s.playing);
  const speed = useReplay((s) => s.speed);
  const index = useReplay((s) => s.index);

  useEffect(() => {
    if (!playing) return;
    const delay = BASE_MS / speed;
    const timer = window.setTimeout(() => {
      const s = useReplay.getState();
      if (!s.range) return;
      if (s.index >= s.range.commits.length) {
        s.setPlaying(false); // end of the replay
      } else {
        s.setIndex(s.index + 1);
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [playing, speed, index]);
}
