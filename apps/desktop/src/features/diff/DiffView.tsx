// Unified + split diff rendering with windowed syntax highlighting and
// row virtualization. Parses git's unified patch (presentation only — git
// semantics live in the engine).

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { buildSplitRows, parseDiff, wordDiff, type DiffLine, type ParsedDiff, type SplitRow } from "../../lib/diffParse";
import { highlightLines } from "../../lib/highlight";
import { langForPath } from "../../lib/langs";
import { escapeHtml } from "../../lib/format";
import { useReplay } from "../../stores/replay";
import { SwapIcon, WarningIcon } from "../../components/Icons";

const ROW_HEIGHT = 20;
const OVERSCAN = 30;

// Scroll positions per file (spec 12: moving between frames must not reset
// the viewport — the same file keeps its position).
const scrollPositions = new Map<string, number>();

function useScrollPreservation(scrollKey: string | null, ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !scrollKey) return;
    const saved = scrollPositions.get(scrollKey);
    if (saved !== undefined) {
      el.scrollTop = saved;
    }
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        scrollPositions.set(scrollKey, el.scrollTop);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [scrollKey, ref]);
}

function Highlighted({ html }: { html: string }) {
  return <span className="diff-code-text" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Highlight the visible window of lines; returns escaped plain text until
 *  the worker answers (no flash of unstyled text). */
function useWindowedHighlight(lang: string | null, base: string[], start: number, end: number) {
  const windowTexts = useMemo(() => base.slice(start, end), [base, start, end]);
  const [html, setHtml] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    highlightLines(lang, windowTexts).then((out) => {
      if (!cancelled) setHtml(out);
    });
    return () => {
      cancelled = true;
    };
  }, [lang, windowTexts]);
  return html ?? windowTexts.map(escapeHtml);
}

function WordHighlighted({ text, pair }: { text: string; pair: { prefix: string; mid: string; suffix: string } | null }) {
  if (!pair || pair.mid === "") return <>{text}</>;
  return (
    <>
      {pair.prefix}
      <mark className="wd">{pair.mid}</mark>
      {pair.suffix}
    </>
  );
}

// -- unified -------------------------------------------------------------------

interface UnifiedRow {
  kind: "hunk" | "line";
  line?: DiffLine;
  header?: string;
}

function UnifiedRows({ parsed, lang, wrap, scrollKey }: { parsed: ParsedDiff; lang: string | null; wrap: boolean; scrollKey: string | null }) {
  const rows = useMemo<UnifiedRow[]>(() => {
    const out: UnifiedRow[] = [];
    for (const hunk of parsed.hunks) {
      const header = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
      out.push({ kind: "hunk", header });
      for (const line of hunk.lines) out.push({ kind: "line", line });
    }
    return out;
  }, [parsed]);

  const parentRef = useRef<HTMLDivElement | null>(null);
  useScrollPreservation(scrollKey ? `u:${scrollKey}` : null, parentRef);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });
  const items = virtualizer.getVirtualItems();
  const start = items[0]?.index ?? 0;
  const end = (items.at(-1)?.index ?? 0) + 1;
  const baseTexts = useMemo(() => rows.map((r) => (r.kind === "line" ? r.line!.text : "")), [rows]);
  const html = useWindowedHighlight(lang, baseTexts, start, end);

  return (
    <div ref={parentRef} className={`diff-scroll ${wrap ? "wrap" : ""}`}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((vi) => {
          const row = rows[vi.index];
          if (row.kind === "hunk") {
            return (
              <div key={vi.key} className="diff-hunk-row" style={{ transform: `translateY(${vi.start}px)` }}>
                {row.header}
              </div>
            );
          }
          const line = row.line!;
          const sign = line.kind === "add" ? "+" : line.kind === "del" ? "−" : line.kind === "eof" ? "⏎" : "";
          return (
            <div key={vi.key} className={`diff-line ${line.kind}`} style={{ transform: `translateY(${vi.start}px)` }}>
              <span className="diff-ln old">{line.oldNo ?? ""}</span>
              <span className="diff-ln new">{line.newNo ?? ""}</span>
              <span className="diff-code">
                <span className="diff-sign">{sign}</span>
                <Highlighted html={html[vi.index - start] ?? ""} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -- split ---------------------------------------------------------------------

function SplitRowsView({ parsed, lang, wrap, scrollKey }: { parsed: ParsedDiff; lang: string | null; wrap: boolean; scrollKey: string | null }) {
  const rows = useMemo(() => buildSplitRows(parsed), [parsed]);
  const parentRef = useRef<HTMLDivElement | null>(null);
  useScrollPreservation(scrollKey ? `s:${scrollKey}` : null, parentRef);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });
  const items = virtualizer.getVirtualItems();
  const start = items[0]?.index ?? 0;
  const end = (items.at(-1)?.index ?? 0) + 1;
  const leftBase = useMemo(() => rows.map((r) => r.left?.text ?? ""), [rows]);
  const rightBase = useMemo(() => rows.map((r) => r.right?.text ?? ""), [rows]);
  const leftHtml = useWindowedHighlight(lang, leftBase, start, end);
  const rightHtml = useWindowedHighlight(lang, rightBase, start, end);

  return (
    <div ref={parentRef} className={`diff-scroll ${wrap ? "wrap" : ""}`}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((vi) => {
          const row: SplitRow = rows[vi.index];
          const kind = row.left?.kind ?? row.right?.kind ?? "ctx";
          const wd =
            row.left && row.right && row.left.kind === "del" && row.right.kind === "add"
              ? wordDiff(row.left.text, row.right.text)
              : null;
          return (
            <div key={vi.key} className={`diff-line split ${kind}`} style={{ transform: `translateY(${vi.start}px)` }}>
              <span className="diff-ln old">{row.oldNo ?? ""}</span>
              <span className="diff-side left">
                <span className="diff-sign">{row.left?.kind === "del" ? "−" : ""}</span>
                {wd ? (
                  <WordHighlighted text={row.left?.text ?? ""} pair={wd.del} />
                ) : (
                  <Highlighted html={leftHtml[vi.index - start] ?? ""} />
                )}
              </span>
              <span className="diff-ln new">{row.newNo ?? ""}</span>
              <span className="diff-side right">
                <span className="diff-sign">{row.right?.kind === "add" ? "+" : ""}</span>
                {wd ? (
                  <WordHighlighted text={row.right?.text ?? ""} pair={wd.add} />
                ) : (
                  <Highlighted html={rightHtml[vi.index - start] ?? ""} />
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -- container -------------------------------------------------------------------

export function DiffView({ patch, oldPath, newPath }: { patch: string | null; oldPath?: string | null; newPath?: string | null }) {
  const diffMode = useReplay((s) => s.diffMode);
  const set = useReplay.setState;
  const [wrap, setWrap] = useState(false);
  const parsed = useMemo(() => (patch ? parseDiff(patch) : null), [patch]);
  const displayPath = newPath ?? oldPath ?? "";
  const lang = langForPath(displayPath);

  if (!patch) {
    return (
      <div className="binary-note">
        <WarningIcon size={16} />
        <div>
          <strong>Binary file</strong>
          <p>Git reports this file as binary — no text diff is available.</p>
        </div>
      </div>
    );
  }

  if (!parsed) {
    return <div className="empty-mini">No textual changes.</div>;
  }
  if (parsed.binary && parsed.hunks.length === 0) {
    // A binary marker with no hunks: show the binary notice, not an empty
    // text toolbar.
    return (
      <div className="binary-note">
        <WarningIcon size={16} />
        <div>
          <strong>Binary file</strong>
          <p>Git reports this file as binary — no text diff is available.</p>
        </div>
      </div>
    );
  }
  if (parsed.hunks.length === 0) {
    return <div className="empty-mini">No textual changes.</div>;
  }

  const statusParts: string[] = [];
  if (parsed.isNew) statusParts.push("new file");
  if (parsed.isDeleted) statusParts.push("deleted file");
  if (parsed.isRename) statusParts.push(`renamed${parsed.similarity !== null ? ` · ${parsed.similarity}% similar` : ""}`);
  if (parsed.oldMode && parsed.newMode && parsed.oldMode !== parsed.newMode) {
    statusParts.push(`mode ${parsed.oldMode} → ${parsed.newMode}`);
  }

  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <span className="diff-path">
          {parsed.isRename && parsed.oldPath ? (
            <>{parsed.oldPath} <span className="dim">→</span> {parsed.newPath}</>
          ) : (
            displayPath
          )}
        </span>
        {statusParts.length > 0 && <span className="dim">{statusParts.join(" · ")}</span>}
        <span className="spacer" />
        <button className={`chip ${wrap ? "on" : ""}`} onClick={() => setWrap(!wrap)} title="Wrap long lines">
          wrap
        </button>
        <button
          className="chip"
          onClick={() => set({ diffMode: diffMode === "unified" ? "split" : "unified" })}
          title="Toggle unified / split view"
        >
          <SwapIcon size={12} /> {diffMode === "unified" ? "split" : "unified"}
        </button>
      </div>
      {diffMode === "unified" ? (
        <UnifiedRows parsed={parsed} lang={lang} wrap={wrap} scrollKey={displayPath} />
      ) : (
        <SplitRowsView parsed={parsed} lang={lang} wrap={wrap} scrollKey={displayPath} />
      )}
    </div>
  );
}
