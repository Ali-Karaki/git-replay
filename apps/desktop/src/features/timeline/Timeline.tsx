// The timeline: one canvas, one paint per frame. Handles any history size —
// per-commit marks when they fit, day-bucket aggregation when they don't
// (ADR-0004). Dragging scrubs the playhead; the data is already prefetched.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDateTime } from "../../lib/format";
import { useReplay } from "../../stores/replay";
import type { ReplayRange } from "../../lib/types";
import { ZoomInIcon, ZoomOutIcon } from "../../components/Icons";

const PAD = 16;
const HEIGHT = 64;
const MIN_PX_PER_COMMIT = 3;
const MAX_PX_PER_COMMIT = 48;

interface DayBucket {
  count: number;
  firstIndex: number; // frame index
  lastIndex: number;
  day: number;
}

interface Layout {
  pxPer: number;
  aggregated: boolean;
  buckets: DayBucket[] | null;
  xOf: (frameIndex: number) => number;
  frameAt: (x: number) => number;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Heuristic chapters (spec 21): an alternate timeline presentation, never a
 *  replacement for the raw commits — clicking a chapter jumps to its start. */
export interface Chapter {
  start: number;
  title: string;
}

export function computeChapters(range: ReplayRange, hasWt: boolean): Chapter[] {
  const chapters: Chapter[] = [{ start: 0, title: "Base" }];
  const prefixOf = (c: ReplayRange["commits"][0]): string | null => {
    const m = c.subject.match(/^(\w+)(\([^)]*\))?:/);
    return m ? m[1].toLowerCase() : null;
  };
  const titleOf = (c: ReplayRange["commits"][0]): string => {
    const p = prefixOf(c);
    if (p) return p[0].toUpperCase() + p.slice(1);
    if (c.parents.length > 1) return "Merge";
    const words = c.subject.split(/\s+/).slice(0, 3).join(" ");
    return words.length > 26 ? words.slice(0, 26) + "…" : words;
  };
  for (let i = 1; i <= range.commits.length; i++) {
    const c = range.commits[i - 1];
    const prev = range.commits[i - 2];
    let startNew: boolean;
    if (!prev) {
      startNew = true;
    } else {
      const timeGap = c.commitTs - prev.commitTs > 3 * 86_400;
      const p1 = prefixOf(prev);
      const p2 = prefixOf(c);
      const prefixChange = !!p1 && !!p2 && p1 !== p2;
      const afterMerge = prev.parents.length > 1;
      const isMergeCommit = c.parents.length > 1;
      startNew = timeGap || prefixChange || afterMerge || isMergeCommit;
    }
    if (startNew) chapters.push({ start: i, title: titleOf(c) });
  }
  if (hasWt) chapters.push({ start: range.commits.length + 1, title: "Working Tree" });
  return chapters;
}

function buildLayout(
  range: ReplayRange,
  hasWt: boolean,
  width: number,
  zoom: number | "fit",
): Layout {
  const n = range.commits.length + (hasWt ? 1 : 0); // frames = n + 1
  const usable = width - PAD * 2;
  let pxPer = zoom === "fit" ? usable / Math.max(n, 1) : zoom;
  const aggregated = pxPer < MIN_PX_PER_COMMIT;

  if (!aggregated) {
    pxPer = Math.min(pxPer, MAX_PX_PER_COMMIT);
    return {
      pxPer,
      aggregated: false,
      buckets: null,
      xOf: (i) => PAD + i * pxPer,
      frameAt: (x) => Math.round((x - PAD) / pxPer),
    };
  }

  // Day buckets over frames 0..n (frame 0 uses the base commit's date; the
  // working-tree frame lands in today's bucket).
  const DAY = 86_400;
  const frames: Array<{ ts: number; index: number }> = [{ ts: range.baseTs, index: 0 }];
  range.commits.forEach((c, i) => frames.push({ ts: c.commitTs, index: i + 1 }));
  if (hasWt) frames.push({ ts: Math.floor(Date.now() / 1000), index: range.commits.length + 1 });
  const byDay = new Map<number, DayBucket>();
  for (const f of frames) {
    const day = Math.floor(f.ts / DAY);
    const b = byDay.get(day);
    if (b) {
      b.count += 1;
      b.lastIndex = f.index;
    } else {
      byDay.set(day, { count: 1, firstIndex: f.index, lastIndex: f.index, day });
    }
  }
  const buckets = [...byDay.values()].sort((a, b) => a.day - b.day);
  const bucketW = usable / Math.max(buckets.length, 1);
  return {
    pxPer: 1,
    aggregated: true,
    buckets,
    xOf: (i) => {
      const bucketIdx = buckets.findIndex((b) => i >= b.firstIndex && i <= b.lastIndex);
      if (bucketIdx === -1) return PAD;
      return PAD + bucketIdx * bucketW + bucketW / 2;
    },
    frameAt: (x) => {
      const idx = Math.floor((x - PAD) / bucketW);
      const b = buckets[Math.min(Math.max(idx, 0), buckets.length - 1)];
      return b ? b.firstIndex : 0;
    },
  };
}

export function Timeline() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; text: string; title: string } | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const dragState = useRef<{ dragging: boolean }>({ dragging: false });

  const range = useReplay((s) => s.range);
  const index = useReplay((s) => s.index);
  const zoom = useReplay((s) => s.timelineZoom);
  const hasWorkingTree = useReplay((s) => s.hasWorkingTree);
  const groupChapters = useReplay((s) => s.groupChapters);
  const setIndex = useReplay((s) => s.setIndex);
  const setTimelineZoom = useReplay((s) => s.setTimelineZoom);

  const chapters = useMemo(() => (range ? computeChapters(range, hasWorkingTree) : []), [range, hasWorkingTree]);
  const totalFrames = range ? range.commits.length + 1 + (hasWorkingTree ? 1 : 0) : 0;
  const n = totalFrames - 1;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !range) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    if (width === 0) return;
    canvas.width = width * dpr;
    canvas.height = HEIGHT * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const layout = buildLayout(range, hasWorkingTree, width, zoom);
    const cy = HEIGHT / 2;
    const node = cssVar("--tl-node", "#4a5162");
    const accent = cssVar("--accent", "#4f7dff");
    const merge = cssVar("--tl-merge", "#8a5cf6");
    const add = cssVar("--add", "#3fb950");
    const axis = cssVar("--border", "#262a33");
    const text = cssVar("--text-dim", "#9aa2af");

    ctx.clearRect(0, 0, width, HEIGHT);
    ctx.strokeStyle = axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, cy);
    ctx.lineTo(width - PAD, cy);
    ctx.stroke();

    const isMerge = (frameIdx: number) =>
      frameIdx > 0 && frameIdx <= range.commits.length && range.commits[frameIdx - 1].parents.length > 1;
    const isWt = (frameIdx: number) => hasWorkingTree && frameIdx === range.commits.length + 1;

    const drawNode = (x: number, opts: { current?: boolean; merge?: boolean; base?: boolean; head?: boolean; wt?: boolean }) => {
      ctx.beginPath();
      if (opts.current) {
        ctx.arc(x, cy, 6, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, cy, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = cssVar("--bg", "#101216");
        ctx.fill();
      } else {
        ctx.arc(x, cy, opts.base || opts.head || opts.wt ? 4.5 : 3.2, 0, Math.PI * 2);
        if (opts.merge) {
          ctx.fillStyle = merge;
          ctx.fill();
        } else if (opts.wt) {
          ctx.fillStyle = "transparent";
          ctx.strokeStyle = add;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else if (opts.base || opts.head) {
          ctx.fillStyle = "transparent";
          ctx.strokeStyle = node;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.fillStyle = node;
          ctx.fill();
        }
      }
    };

    const drawPlayhead = (x: number) => {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x, HEIGHT - 6);
      ctx.stroke();
    };

    if (layout.aggregated && layout.buckets) {
      const maxCount = Math.max(...layout.buckets.map((b) => b.count));
      const bucketW = (width - PAD * 2) / Math.max(layout.buckets.length, 1);
      layout.buckets.forEach((b, bi) => {
        const h = 4 + (b.count / maxCount) * 16;
        const x = PAD + bi * bucketW + bucketW / 2;
        const isCur = index >= b.firstIndex && index <= b.lastIndex;
        const hasMerge = range.commits.slice(Math.max(b.firstIndex - 1, 0), b.lastIndex).some((c) => c.parents.length > 1);
        ctx.fillStyle = isCur ? accent : hasMerge ? merge : node;
        ctx.beginPath();
        ctx.roundRect(x - Math.max(bucketW * 0.3, 1.5), cy - h / 2, Math.max(bucketW * 0.6, 3), h, 2);
        ctx.fill();
      });
      drawPlayhead(layout.xOf(index));
      // Day labels on the first and last bucket.
      ctx.fillStyle = text;
      ctx.font = "10px ui-sans-serif, system-ui";
      const first = layout.buckets[0];
      const last = layout.buckets[layout.buckets.length - 1];
      const fmt = (ts: number) => new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
      ctx.fillText(fmt(first.day * 86_400), PAD, HEIGHT - 4);
      const lastLabel = fmt(last.day * 86_400);
      ctx.fillText(lastLabel, width - PAD - ctx.measureText(lastLabel).width, HEIGHT - 4);
    } else {
      // Per-commit marks; head/base labels drawn when they fit.
      const stepX = layout.pxPer;
      for (let i = 0; i <= n; i++) {
        const x = layout.xOf(i);
        drawNode(x, {
          current: i === index,
          merge: isMerge(i),
          base: i === 0,
          head: i === n,
          wt: isWt(i),
        });
      }
      // Chapter separators (alternate presentation — raw marks stay visible).
      if (groupChapters && stepX >= 10) {
        for (const ch of chapters) {
          if (ch.start === 0) continue;
          const x = layout.xOf(ch.start);
          ctx.strokeStyle = axis;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(x, 6);
          ctx.lineTo(x, HEIGHT - 16);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = text;
          ctx.font = "10px ui-sans-serif, system-ui";
          ctx.fillText(ch.title, x + 4, 12);
        }
      }
      drawPlayhead(layout.xOf(index));
      if (stepX >= 26) {
        ctx.fillStyle = text;
        ctx.font = "10px ui-sans-serif, system-ui";
        ctx.fillText("BASE", PAD - 2, 12);
        ctx.fillText("HEAD", width - PAD - 20, 12);
        if (hasWorkingTree) ctx.fillText("WT", layout.xOf(n) + 6, 12);
      }
    }

    // Hover ring (drawn last so it sits above nodes).
    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx <= n) {
      const x = layout.xOf(hoverIdx);
      ctx.beginPath();
      ctx.arc(x, cy, 8, 0, Math.PI * 2);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }, [range, index, zoom, hoverIdx, hasWorkingTree, groupChapters, chapters, n]);

  useEffect(() => {
    const raf = requestAnimationFrame(redraw);
    return () => cancelAnimationFrame(raf);
  }, [redraw]);

  // Track container width.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(redraw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [redraw]);

  if (!range) return null;

  const frameAtPoint = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const layout = buildLayout(range, hasWorkingTree, rect.width, zoom);
    const idx = layout.frameAt(clientX - rect.left);
    return Math.min(Math.max(idx, 0), n);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const idx = frameAtPoint(e.clientX);
    setHoverIdx(idx);
    const rect = canvasRef.current!.getBoundingClientRect();
    let title: string;
    let text: string;
    if (idx === 0) {
      title = "BASE";
      text = "Starting point";
    } else if (hasWorkingTree && idx === range.commits.length + 1) {
      title = "Working Tree";
      text = "Uncommitted changes vs HEAD";
    } else {
      const commit = range.commits[idx - 1];
      title = commit.subject;
      text = `Commit ${idx} / ${range.commits.length} · ${formatDateTime(commit.commitTs)} · ${commit.sha.slice(0, 7)}`;
    }
    setTooltip({ x: e.clientX - rect.left, text, title });
    if (dragState.current.dragging) {
      setIndex(idx);
    }
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragState.current.dragging = true;
    setIndex(frameAtPoint(e.clientX));
    e.preventDefault();
  };

  const onMouseUp = () => {
    dragState.current.dragging = false;
  };

  const onWheel = (e: React.WheelEvent) => {
    const current = zoom === "fit" ? 12 : zoom;
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    const next = Math.min(Math.max(current * factor, 2), MAX_PX_PER_COMMIT);
    setTimelineZoom(next);
  };

  const zoomIn = () => setTimelineZoom(Math.min((zoom === "fit" ? 12 : zoom) * 1.5, MAX_PX_PER_COMMIT));
  const zoomOut = () => {
    const current = zoom === "fit" ? 12 : zoom;
    const next = current / 1.5;
    setTimelineZoom(next < 2 ? "fit" : next);
  };

  return (
    <div className="timeline" ref={wrapRef} onMouseMove={onMouseMove} onMouseLeave={() => { setHoverIdx(null); setTooltip(null); }}
      onMouseDown={onMouseDown} onMouseUp={onMouseUp} onWheel={onWheel}>
      <canvas ref={canvasRef} className="timeline-canvas" />
      {tooltip && (
        <div className="timeline-tooltip" style={{ left: Math.min(Math.max(tooltip.x, 70), (wrapRef.current?.clientWidth ?? 400) - 70) }}>
          <div className="timeline-tooltip-title">{tooltip.title}</div>
          <div className="timeline-tooltip-sub">{tooltip.text}</div>
        </div>
      )}
      <div className="timeline-zoom">
        <button
          className={`chip ${groupChapters ? "on" : ""}`}
          onClick={() => useReplay.setState({ groupChapters: !groupChapters })}
          title="Group commits into chapters (alternate view — raw commits stay visible)"
        >
          chapters
        </button>
        <button className="btn-icon" onClick={zoomOut} title="Zoom out (fit when far)" aria-label="Zoom out"><ZoomOutIcon size={13} /></button>
        <button className="btn-icon" onClick={() => setTimelineZoom("fit")} title="Fit to width" aria-label="Fit to width"
          style={{ fontSize: 10, fontWeight: 600, minWidth: 22 }}>{zoom === "fit" ? "≡" : `${Math.round(zoom)}px`}</button>
        <button className="btn-icon" onClick={zoomIn} title="Zoom in" aria-label="Zoom in"><ZoomInIcon size={13} /></button>
      </div>
    </div>
  );
}
