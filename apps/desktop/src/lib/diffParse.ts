// Parses git's unified diff output into structured hunks for rendering.
// The engine produces the raw patch (git semantics); this module is purely
// presentation.

export interface DiffLine {
  kind: "ctx" | "add" | "del" | "eof";
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface ParsedDiff {
  banners: string[];
  binary: boolean;
  hunks: Hunk[];
  oldPath: string | null;
  newPath: string | null;
  isNew: boolean;
  isDeleted: boolean;
  isRename: boolean;
  oldMode: string | null;
  newMode: string | null;
  similarity: number | null;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseDiff(patch: string): ParsedDiff {
  const lines = patch.split("\n");
  const result: ParsedDiff = {
    banners: [],
    binary: false,
    hunks: [],
    oldPath: null,
    newPath: null,
    isNew: false,
    isDeleted: false,
    isRename: false,
    oldMode: null,
    newMode: null,
    similarity: null,
  };

  let current: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const raw of lines) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;

    const hunkMatch = line.match(HUNK_RE);
    if (hunkMatch) {
      current = {
        oldStart: Number(hunkMatch[1]),
        oldCount: hunkMatch[2] !== undefined ? Number(hunkMatch[2]) : 1,
        newStart: Number(hunkMatch[3]),
        newCount: hunkMatch[4] !== undefined ? Number(hunkMatch[4]) : 1,
        lines: [],
      };
      result.hunks.push(current);
      oldNo = current.oldStart;
      newNo = current.newStart;
      continue;
    }

    if (current) {
      if (line.startsWith("+")) {
        current.lines.push({ kind: "add", oldNo: null, newNo: newNo++, text: line.slice(1) });
      } else if (line.startsWith("-")) {
        current.lines.push({ kind: "del", oldNo: oldNo++, newNo: null, text: line.slice(1) });
      } else if (line.startsWith(" ")) {
        current.lines.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
      } else if (line.startsWith("\\")) {
        current.lines.push({ kind: "eof", oldNo: null, newNo: null, text: line });
      }
      // Anything else inside a hunk (e.g. a second header) is skipped.
      continue;
    }

    // Header area.
    result.banners.push(line);
    if (line.startsWith("Binary files ")) result.binary = true;
    if (line.startsWith("new file mode")) result.isNew = true;
    if (line.startsWith("deleted file mode")) result.isDeleted = true;
    if (line.startsWith("old mode ")) result.oldMode = line.slice("old mode ".length);
    if (line.startsWith("new mode ")) result.newMode = line.slice("new mode ".length);
    if (line.startsWith("similarity index ")) {
      const pct = line.match(/(\d+)%/);
      if (pct) result.similarity = Number(pct[1]);
    }
    if (line.startsWith("rename from ") || line.startsWith("copy from ")) result.isRename = true;
    const oldMatch = line.match(/^--- a\/(.*)$/);
    if (oldMatch && oldMatch[1] !== "/dev/null") result.oldPath = oldMatch[1];
    const newMatch = line.match(/^\+\+\+ b\/(.*)$/);
    if (newMatch && newMatch[1] !== "/dev/null") result.newPath = newMatch[1];
  }

  return result;
}

// -- split view ---------------------------------------------------------------

export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
  oldNo: number | null;
  newNo: number | null;
}

/** Pair del/add lines within each hunk (naive sequential pairing). */
export function buildSplitRows(parsed: ParsedDiff): SplitRow[] {
  const rows: SplitRow[] = [];
  for (const hunk of parsed.hunks) {
    const lines = hunk.lines;
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.kind === "ctx") {
        rows.push({ left: line, right: line, oldNo: line.oldNo, newNo: line.newNo });
        i++;
        continue;
      }
      if (line.kind === "eof") {
        rows.push({ left: line, right: line, oldNo: null, newNo: null });
        i++;
        continue;
      }
      // Collect a run of dels followed by a run of adds.
      const dels: DiffLine[] = [];
      while (i < lines.length && lines[i].kind === "del") {
        dels.push(lines[i]);
        i++;
      }
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].kind === "add") {
        adds.push(lines[i]);
        i++;
      }
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k++) {
        const left = dels[k] ?? null;
        const right = adds[k] ?? null;
        rows.push({ left, right, oldNo: left?.oldNo ?? null, newNo: right?.newNo ?? null });
      }
    }
  }
  return rows;
}

// -- word-level diff ------------------------------------------------------------

export interface WordRange {
  prefix: string;
  mid: string;
  suffix: string;
}

/** Common prefix/suffix split between a removed and an added line. */
export function wordDiff(del: string, add: string): { del: WordRange; add: WordRange } {
  let p = 0;
  const minLen = Math.min(del.length, add.length);
  while (p < minLen && del[p] === add[p]) p++;
  let ds = del.length;
  let as = add.length;
  while (ds > p && as > p && del[ds - 1] === add[as - 1]) {
    ds--;
    as--;
  }
  return {
    del: { prefix: del.slice(0, p), mid: del.slice(p, ds), suffix: del.slice(ds) },
    add: { prefix: add.slice(0, p), mid: add.slice(p, as), suffix: add.slice(as) },
  };
}
