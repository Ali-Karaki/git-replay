// Transport controls: first/prev/play-pause/next/last + speed + position.

import { useReplay } from "../../stores/replay";
import { FirstIcon, LastIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from "../../components/Icons";

export function Transport() {
  const range = useReplay((s) => s.range);
  const index = useReplay((s) => s.index);
  const playing = useReplay((s) => s.playing);
  const speed = useReplay((s) => s.speed);
  const setPlaying = useReplay((s) => s.setPlaying);
  const setIndex = useReplay((s) => s.setIndex);
  const step = useReplay((s) => s.step);

  if (!range) return null;
  const n = range.commits.length;
  const atStart = index === 0;
  const atEnd = index >= n;

  return (
    <div className="transport">
      <button className="btn-icon" onClick={() => setIndex(0)} disabled={atStart} title="First frame (Home)" aria-label="First frame">
        <FirstIcon />
      </button>
      <button className="btn-icon" onClick={() => step(-1)} disabled={atStart} title="Previous commit (←)" aria-label="Previous commit">
        <PrevIcon />
      </button>
      <button className="btn-play" onClick={() => setPlaying(!playing)} title="Play / Pause (Space)" aria-label={playing ? "Pause" : "Play"}>
        {playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
        <span className="btn-play-label">{playing ? "Pause" : "Play"}</span>
      </button>
      <button className="btn-icon" onClick={() => step(1)} disabled={atEnd} title="Next commit (→)" aria-label="Next commit">
        <NextIcon />
      </button>
      <button className="btn-icon" onClick={() => setIndex(n)} disabled={atEnd} title="Last frame (End)" aria-label="Last frame">
        <LastIcon />
      </button>

      <select
        className="select"
        value={speed}
        onChange={(e) => useReplay.setState({ speed: Number(e.target.value) })}
        title="Playback speed"
        aria-label="Playback speed"
      >
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
      </select>

      <span className="transport-position">
        {index === 0 ? <span className="dim">Base</span> : <strong>Commit {index}</strong>} <span className="dim">/ {n}</span>
      </span>
    </div>
  );
}
