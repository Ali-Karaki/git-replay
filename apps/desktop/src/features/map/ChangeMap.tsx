// Change map (spec 14): file × frame activity grid showing where development
// effort moved over time. Canvas cells + sticky HTML labels; click a cell to
// jump, click a row to select the file.

import { useEffect, useMemo, useRef, useState } from "react";
import { getCommitDetail } from "../../lib/dataCaches";
import { formatDateTime, shortSha } from "../../lib/format";
import type { CommitDetail, FileChange } from "../../lib/types";
import { frameCount, useReplay } from "../../stores/replay";

const ROW_H = 15;
const LABEL_W = 230;
const MAX_ROWS = 150;
const MAX_COMMITS = 500;

interface Cell {
  row: number;
  col: number; // commit index 0..N-1 (frame index = col + 1)
  change: FileChange;
}

function statusColor(status: string, mode: string): string {
  const root = document.documentElement;
  const v = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();
  switch (status) {
    case "added":
      return v("--add");
    case "modified":
      return mode === "dark" ? v("--accent") : v("--accent");
    case "deleted":
      return v("--del");
    case "renamed":
    case "copied":
      return v("--rename");
    case "untracked":
      return "#0ea5a5";
    default:
      return v("--text-faint");
  }
}

export function ChangeMap() {
  const repo = useReplay((s) => s.repo);
  const range = useReplay((s) => s.range);
  const wtFrame = useReplay((s) => s.wtFrame);
  const hasWorkingTree = useReplay((s) => s.hasWorkingTree);
  const setIndex = useReplay((s) => s.setIndex);
  const setSelectedFile = useReplay((s) => s.setSelectedFile);
  const selectedFile = useReplay((s) => s.selectedFile);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLButtonElement | null>(null);
  const [details, setDetails] = useState<Map<string, CommitDetail>>(new Map());
  const [progress, setProgress] = useState(0);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const themeTick = useReplay((s) => s.theme);

  const commitCount = range ? Math.min(range.commits.length, MAX_COMMITS) : 0;
  const totalCols = commitCount + (hasWorkingTree ? 1 : 0);

  // Load commit details for the map window, in parallel batches.
  useEffect(() => {
    if (!repo || !range) return;
    let cancelled = false;
    const map = new Map<string, CommitDetail>();
    setDetails(new Map());
    setProgress(0);
    const targets = range.commits.slice(0, commitCount);
    let cursor = 0;
    (async () => {
      while (cursor < targets.length && !cancelled) {
        const batch = targets.slice(cursor, cursor + 8);
        const results = await Promise.all(batch.map((c) => getCommitDetail(repo.id, c.sha, null).catch(() => null)));
        batch.forEach((c, i) => {
          const result = results[i];
          if (result) map.set(c.sha, result);
        });
        if (!cancelled) {
          setDetails(new Map(map));
          setProgress(Math.round(((cursor + batch.length) / targets.length) * 100));
        }
        cursor += batch.length;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, range, commitCount]);

  // Rows: files ordered by first appearance in the range.
  const rows = useMemo(() => {
    if (!range) return [];
    const first: string[] = [];
    const seen = new Set<string>();
    for (const c of range.commits.slice(0, commitCount)) {
      const d = details.get(c.sha);
      if (!d) continue;
      for (const f of d.files) {
        if (!seen.has(f.newPath)) {
          seen.add(f.newPath);
          first.push(f.newPath);
        }
        if (f.oldPath && !seen.has(f.oldPath)) {
          seen.add(f.oldPath);
          first.push(f.oldPath);
        }
      }
    }
    return first.slice(0, MAX_ROWS);
  }, [range, details, commitCount]);

  // Cell index.
  const cells = useMemo<Cell[]>(() => {
    if (!range) return [];
    const rowOf = new Map<string, number>();
    rows.forEach((r, i) => {
      rowOf.set(r, i);
    });
    const out: Cell[] = [];
    range.commits.slice(0, commitCount).forEach((c, col) => {
      const d = details.get(c.sha);
      if (!d) return;
      for (const f of d.files) {
        let r = rowOf.get(f.newPath);
        if (r === undefined && f.oldPath) r = rowOf.get(f.oldPath);
        if (r !== undefined) out.push({ row: r, col, change: f });
      }
    });
    if (hasWorkingTree && wtFrame) {
      for (const f of wtFrame.files) {
        let r = rowOf.get(f.newPath);
        if (r === undefined && f.oldPath) r = rowOf.get(f.oldPath);
        if (r !== undefined) out.push({ row: r, col: commitCount, change: f });
      }
    }
    return out;
  }, [range, rows, details, commitCount, hasWorkingTree, wtFrame]);

  // Draw. `themeTick` is both a repaint trigger when the theme changes and a
  // fallback for the CSS-var reads below.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = LABEL_W + totalCols * 10 + 40;
    const height = Math.max(rows.length * ROW_H + 24, 60);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const css = (name: string, fb: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
    // themeTick grounds the fallbacks: even if the CSS vars are unavailable,
    // the canvas stays consistent with the selected theme.
    const dark = themeTick === "dark" || (themeTick === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    ctx.fillStyle = css("--bg-panel", dark ? "#15171b" : "#ffffff");
    ctx.fillRect(0, 0, width, height);

    // Column headers: commit numbers + short shas.
    ctx.fillStyle = css("--text-faint", "#888");
    ctx.font = "9px ui-monospace, monospace";
    for (let col = 0; col < totalCols; col++) {
      const x = LABEL_W + col * 10;
      const label = col === commitCount ? "WT" : String(col + 1);
      ctx.fillText(label, x + 1, 10);
    }
    // Rows.
    ctx.font = "11px ui-monospace, monospace";
    rows.forEach((path, r) => {
      const y = 24 + r * ROW_H;
      ctx.fillStyle = css("--text-dim", "#666");
      const label = path.length > 45 ? `…${path.slice(-44)}` : path;
      ctx.fillText(label, 8, y + 11);
      ctx.strokeStyle = css("--border", "#ddd");
      ctx.beginPath();
      ctx.moveTo(LABEL_W - 6, y + ROW_H - 1);
      ctx.lineTo(width - 6, y + ROW_H - 1);
      ctx.stroke();
    });
    // Cells (colors resolved once per draw, not per cell).
    const colors = new Map<string, string>();
    const colorOf = (status: string) => {
      let c = colors.get(status);
      if (!c) {
        c = statusColor(status, css("--theme-mode", "light"));
        colors.set(status, c);
      }
      return c;
    };
    const merged = new Map<string, number>(); // `${row}:${col}` → count for stacking
    for (const cell of cells) {
      const key = `${cell.row}:${cell.col}`;
      const k = merged.get(key) ?? 0;
      merged.set(key, k + 1);
      const x = LABEL_W + cell.col * 10 + 2;
      const y = 24 + cell.row * ROW_H + 2 + k * 2;
      ctx.fillStyle = colorOf(cell.change.status);
      ctx.beginPath();
      ctx.roundRect(x, y, 6, 6, 1.5);
      ctx.fill();
    }
    // Selected row highlight.
    if (selectedFile) {
      const r = rows.indexOf(selectedFile);
      if (r >= 0) {
        ctx.fillStyle = css("--accent-soft", "rgba(61,107,230,0.12)");
        ctx.fillRect(0, 24 + r * ROW_H, width, ROW_H);
      }
    }
    // Hover outline.
    if (hover) {
      const x = LABEL_W + hover.col * 10 + 2;
      const y = 24 + hover.row * ROW_H + 2;
      ctx.strokeStyle = css("--accent", "#3d6be6");
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 1.5, y - 1.5, 9, 9);
    }
  }, [cells, rows, totalCols, commitCount, selectedFile, hover, themeTick]);

  if (!repo || !range) return null;

  const n = frameCount(range, hasWorkingTree) - 1;

  const showCell = (col: number, row: number, x: number, y: number) => {
    const cell = cells.find((c) => c.row === row && c.col === col);
    setHover(cell ?? null);
    if (cell) {
      const path = cell.change.oldPath ? `${cell.change.oldPath} → ${cell.change.newPath}` : cell.change.newPath;
      const commitLabel =
        cell.col === commitCount
          ? "Working tree"
          : `Commit ${cell.col + 1} · ${shortSha(range.commits[cell.col].sha)} · ${formatDateTime(range.commits[cell.col].commitTs)}`;
      setTooltip({ x, y, text: `${path}\n${commitLabel}\n${cell.change.status}` });
    } else {
      setTooltip(null);
    }
  };

  /** Activate a cell — the shared action for pointer clicks and Enter/Space. */
  const activateCell = (col: number, row: number) => {
    if (row >= 0 && row < rows.length && col >= 0 && col < totalCols) {
      setSelectedFile(rows[row]);
      setIndex(col === commitCount ? commitCount + 1 : col + 1);
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.floor((x - LABEL_W) / 10);
    const row = Math.floor((y - 24) / ROW_H);
    if (col >= 0 && col < totalCols && row >= 0 && row < rows.length) {
      showCell(col, row, x, y);
    } else {
      setHover(null);
      setTooltip(null);
    }
  };

  const onClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.floor((x - LABEL_W) / 10);
    const row = Math.floor((y - 24) / ROW_H);
    if (row >= 0 && row < rows.length && x < LABEL_W) {
      setSelectedFile(rows[row]);
      return;
    }
    activateCell(col, row);
  };

  // Keyboard parity for the pointer interactions: arrows move a cell cursor
  // (drawn by the same hover outline), Enter/Space activates it.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const cur = hover ?? { row: Math.max(Math.floor((rows.length - 1) / 2), 0), col: Math.floor(totalCols / 2) };
    let { row, col } = cur;
    if (e.key === "ArrowLeft") col -= 1;
    else if (e.key === "ArrowRight") col += 1;
    else if (e.key === "ArrowUp") row -= 1;
    else if (e.key === "ArrowDown") row += 1;
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activateCell(cur.col, cur.row);
      return;
    } else return;
    e.preventDefault();
    row = Math.min(Math.max(row, 0), rows.length - 1);
    col = Math.min(Math.max(col, 0), totalCols - 1);
    showCell(col, row, LABEL_W + col * 10 + 2, 24 + row * ROW_H + 2);
  };

  return (
    <div className="map-view">
      <div className="panel-toolbar">
        <span className="panel-title">
          Change map
          <span className="dim">
            {rows.length} files × {totalCols} frames
            {commitCount >= MAX_COMMITS ? ` (first ${MAX_COMMITS} commits)` : ""}
          </span>
        </span>
        <span className="dim map-progress">
          {progress < 100 ? `indexing… ${progress}%` : "click a cell to jump · click a file to select"}
        </span>
      </div>
      <div className="map-wrap">
        <button
          type="button"
          className="map-scroll"
          ref={scrollRef}
          aria-label="Change map — arrow keys move the cell cursor, Enter jumps to the commit"
          onMouseMove={onMouseMove}
          onClick={onClick}
          onKeyDown={onKeyDown}
          onMouseLeave={() => {
            setHover(null);
            setTooltip(null);
          }}
        >
          <canvas ref={canvasRef} className="map-canvas" />
        </button>
        {tooltip && (
          <div className="map-tooltip" style={{ left: tooltip.x + 14, top: tooltip.y + 12 }}>
            {tooltip.text.split("\n").map((l) => (
              <div key={l}>{l}</div>
            ))}
          </div>
        )}
      </div>
      <div className="map-legend dim">
        <span>
          <i className="dot" style={{ background: statusColor("added", "light") }} /> created
        </span>
        <span>
          <i className="dot" style={{ background: "var(--accent)" }} /> modified
        </span>
        <span>
          <i className="dot" style={{ background: statusColor("deleted", "light") }} /> deleted
        </span>
        <span>
          <i className="dot" style={{ background: statusColor("renamed", "light") }} /> moved/copied
        </span>
        <span>
          <i className="dot" style={{ background: "#0ea5a5" }} /> untracked
        </span>
        <span className="spacer" />
        <span>commits → ({n} total)</span>
      </div>
    </div>
  );
}
