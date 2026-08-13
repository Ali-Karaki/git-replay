// Transport controls: first/prev/play-pause/next/last + speed + position.

import { frameCount, useReplay } from "../../stores/replay";
import { FirstIcon, LastIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from "../../components/Icons";

export function Transport() {
  const range = useReplay((s) => s.range);
  const index = useReplay((s) => s.index);
  const playing = useReplay((s) => s.playing);
  const speed = useReplay((s) => s.speed);
  const adaptive = useReplay((s) => s.adaptivePlayback);
  const hasWorkingTree = useReplay((s) => s.hasWorkingTree);
  const setPlaying = useReplay((s) => s.setPlaying);
  const setIndex = useReplay((s) => s.setIndex);
  const step = useReplay((s) => s.step);

  if (!range) return null;
  const total = frameCount(range, hasWorkingTree) - 1;
  const atStart = index === 0;
  const atEnd = index >= total;

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
      <button className="btn-icon" onClick={() => setIndex(total)} disabled={atEnd} title="Last frame (End)" aria-label="Last frame">
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

      <button
        className={`chip ${adaptive ? "on" : ""}`}
        onClick={() => useReplay.setState({ adaptivePlayback: !adaptive })}
        title="Adaptive playback: small commits flash by, substantial ones pause"
      >
        adaptive
      </button>

      <span className="transport-position">
        {index === 0 ? (
          <span className="dim">Base</span>
        ) : index === total && hasWorkingTree ? (
          <strong>Working Tree</strong>
        ) : (
          <strong>Commit {index}</strong>
        )}{" "}
        <span className="dim">/ {total}</span>
        {playing && index > 0 && index <= range.commits.length && (
          <span className="playing-subject dim" title={range.commits[index - 1].subject}>
            {range.commits[index - 1].subject}
          </span>
        )}
      </span>
    </div>
  );
}
