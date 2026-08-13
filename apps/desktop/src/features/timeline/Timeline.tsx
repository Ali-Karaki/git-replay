// The timeline: one canvas, one paint per frame. All geometry and chapter
// heuristics live in lib/timelineModel (unit-tested); this component only
// paints and hit-tests (ADR-0004).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDateTime } from "../../lib/format";
import {
  buildTimelineLayout, computeChapters, MAX_PX_PER_COMMIT, TIMELINE_HEIGHT, TIMELINE_PAD,
} from "../../lib/timelineModel";
import { useReplay } from "../../stores/replay";
import { ZoomInIcon, ZoomOutIcon } from "../../components/Icons";

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
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
    canvas.height = TIMELINE_HEIGHT * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const layout = buildTimelineLayout(range, hasWorkingTree, width, zoom);
    const cy = TIMELINE_HEIGHT / 2;
    const node = cssVar("--tl-node", "#4a5162");
    const accent = cssVar("--accent", "#4f7dff");
    const merge = cssVar("--tl-merge", "#8a5cf6");
    const add = cssVar("--add", "#3fb950");
    const axis = cssVar("--border", "#262a33");
    const text = cssVar("--text-dim", "#9aa2af");

    ctx.clearRect(0, 0, width, TIMELINE_HEIGHT);
    ctx.strokeStyle = axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(TIMELINE_PAD, cy);
    ctx.lineTo(width - TIMELINE_PAD, cy);
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
      ctx.lineTo(x, TIMELINE_HEIGHT - 6);
      ctx.stroke();
    };

    if (layout.aggregated && layout.buckets) {
      const maxCount = Math.max(...layout.buckets.map((b) => b.count));
      const bucketW = (width - TIMELINE_PAD * 2) / Math.max(layout.buckets.length, 1);
      layout.buckets.forEach((b, bi) => {
        const h = 4 + (b.count / maxCount) * 16;
        const x = TIMELINE_PAD + bi * bucketW + bucketW / 2;
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
      ctx.fillText(fmt(first.day * 86_400), TIMELINE_PAD, TIMELINE_HEIGHT - 4);
      const lastLabel = fmt(last.day * 86_400);
      ctx.fillText(lastLabel, width - TIMELINE_PAD - ctx.measureText(lastLabel).width, TIMELINE_HEIGHT - 4);
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
          ctx.lineTo(x, TIMELINE_HEIGHT - 16);
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
        ctx.fillText("BASE", TIMELINE_PAD - 2, 12);
        ctx.fillText("HEAD", width - TIMELINE_PAD - 20, 12);
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
    const layout = buildTimelineLayout(range, hasWorkingTree, rect.width, zoom);
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
