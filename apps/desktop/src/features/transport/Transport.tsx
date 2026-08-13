// Transport controls: media-player style — first/prev/play-pause/next/last
// around a big play button, a speed menu, and the position readout.

import { useEffect, useRef, useState } from "react";
import { frameCount, useReplay } from "../../stores/replay";
import {
  FirstIcon, LastIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, SpeedIcon,
} from "../../components/Icons";

const SPEEDS = [0.5, 1, 2] as const;

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
  const set = useReplay.setState;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the speed menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  if (!range) return null;
  const total = frameCount(range, hasWorkingTree) - 1;
  const atStart = index === 0;
  const atEnd = index >= total;
  const commit = index > 0 && index <= range.commits.length ? range.commits[index - 1] : null;

  return (
    <div className="transport">
      <button className="btn-icon" onClick={() => setIndex(0)} disabled={atStart} title="First frame (Home)" aria-label="First frame">
        <FirstIcon />
      </button>
      <button className="btn-icon" onClick={() => step(-1)} disabled={atStart} title="Previous commit (←)" aria-label="Previous commit">
        <PrevIcon />
      </button>
      <button className="btn-play btn-play-big" onClick={() => setPlaying(!playing)} title="Play / Pause (Space)" aria-label={playing ? "Pause" : "Play"}>
        {playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
        <span className="btn-play-label">{playing ? "Pause" : "Play"}</span>
      </button>
      <button className="btn-icon" onClick={() => step(1)} disabled={atEnd} title="Next commit (→)" aria-label="Next commit">
        <NextIcon />
      </button>
      <button className="btn-icon" onClick={() => setIndex(total)} disabled={atEnd} title="Last frame (End)" aria-label="Last frame">
        <LastIcon />
      </button>

      <span className="transport-position">
        {index === 0 ? (
          <strong>Base</strong>
        ) : index === total && hasWorkingTree ? (
          <strong>Working tree</strong>
        ) : (
          <strong>Commit {index} of {range.commits.length}</strong>
        )}
        {commit && (
          <span className="transport-subject" title={commit.subject}>
            {commit.subject}
          </span>
        )}
      </span>

      <div className="speed-control" ref={menuRef}>
        <button
          className="speed-btn"
          onClick={() => setMenuOpen((o) => !o)}
          title="Playback speed"
          aria-label="Playback speed"
          aria-expanded={menuOpen}
        >
          <SpeedIcon size={13} /> {speed}×
        </button>
        {menuOpen && (
          <div className="speed-menu">
            <div className="speed-menu-title dim">Playback speed</div>
            {SPEEDS.map((s) => (
              <button
                key={s}
                className={`speed-option ${speed === s ? "on" : ""}`}
                onClick={() => {
                  set({ speed: s });
                  setMenuOpen(false);
                }}
              >
                {s}×
              </button>
            ))}
            <button
              className={`chip speed-adaptive ${adaptive ? "on" : ""}`}
              role="checkbox"
              aria-checked={adaptive}
              onClick={() => set({ adaptivePlayback: !adaptive })}
            >
              Adaptive speed <span className="dim">(big commits get more time)</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
