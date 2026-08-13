// Pure timeline layout + chapter model (ADR-0004). No React, no canvas — the
// component only paints what this module computes, and the tests cover the
// geometry and heuristics directly.

import type { ReplayRange } from "./types";

export const TIMELINE_HEIGHT = 64;
export const TIMELINE_PAD = 16;
export const MIN_PX_PER_COMMIT = 3;
export const MAX_PX_PER_COMMIT = 48;

export interface DayBucket {
  count: number;
  firstIndex: number;
  lastIndex: number;
  day: number;
}

export interface TimelineLayout {
  pxPer: number;
  aggregated: boolean;
  buckets: DayBucket[] | null;
  xOf(frameIndex: number): number;
  frameAt(x: number): number;
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

export function buildTimelineLayout(
  range: ReplayRange,
  hasWt: boolean,
  width: number,
  zoom: number | "fit",
  scroll = 0,
): TimelineLayout {
  const n = range.commits.length + (hasWt ? 1 : 0); // frames = n + 1
  const usable = width - TIMELINE_PAD * 2;
  let pxPer = zoom === "fit" ? usable / Math.max(n, 1) : zoom;
  const aggregated = pxPer < MIN_PX_PER_COMMIT;

  if (!aggregated) {
    pxPer = Math.min(pxPer, MAX_PX_PER_COMMIT);
    const maxScroll = Math.max(0, n * pxPer - usable);
    const sc = Math.min(Math.max(scroll, 0), maxScroll);
    return {
      pxPer,
      aggregated: false,
      buckets: null,
      xOf: (i) => TIMELINE_PAD - sc + i * pxPer,
      frameAt: (x) => Math.round((x - TIMELINE_PAD + sc) / pxPer),
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
      if (bucketIdx === -1) return TIMELINE_PAD;
      return TIMELINE_PAD + bucketIdx * bucketW + bucketW / 2;
    },
    frameAt: (x) => {
      const idx = Math.floor((x - TIMELINE_PAD) / bucketW);
      const b = buckets[Math.min(Math.max(idx, 0), buckets.length - 1)];
      return b ? b.firstIndex : 0;
    },
  };
}
