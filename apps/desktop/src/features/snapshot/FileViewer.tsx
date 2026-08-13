// File content at a frame: virtualized text with syntax highlighting, images,
// binary/symlink/submodule notices.

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getFileAtCommit } from "../../lib/dataCaches";
import { useData } from "../../lib/useData";
import { formatBytes, isLikelyImage } from "../../lib/format";
import { langForPath } from "../../lib/langs";
import { highlightLines } from "../../lib/highlight";
import { frameSha, useReplay } from "../../stores/replay";
import type { FileAtCommit } from "../../lib/types";
import { EvolutionIcon, ImageIcon, WarningIcon } from "../../components/Icons";
import { ErrorPanel, Skeleton } from "../../components/States";

function TextFile({ file, path }: { file: FileAtCommit; path: string }) {
  const lines = useMemo(() => (file.content ?? "").split("\n"), [file.content]);
  const lang = langForPath(path);
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [wrap, setWrap] = useState(false);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 30,
  });
  const items = virtualizer.getVirtualItems();
  const start = items[0]?.index ?? 0;
  const end = (items.at(-1)?.index ?? 0) + 1;

  const [html, setHtml] = useState<Map<number, string>>(new Map());
  const windowKey = `${start}:${end}`;
  const lastKey = useRef("");
  useEffect(() => {
    if (lastKey.current === windowKey) return;
    lastKey.current = windowKey;
    let cancelled = false;
    highlightLines(lang, lines.slice(start, end)).then((out) => {
      if (cancelled) return;
      const m = new Map<number, string>();
      out.forEach((h, i) => m.set(start + i, h));
      setHtml(m);
    });
    return () => {
      cancelled = true;
    };
  }, [lang, lines, start, end, windowKey]);

  return (
    <div className="file-viewer">
      <div className="diff-toolbar">
        <span className="diff-path">{path}</span>
        <span className="dim">{formatBytes(file.size)} · {lines.length} lines</span>
        <span className="spacer" />
        <button className={`chip ${wrap ? "on" : ""}`} onClick={() => setWrap(!wrap)}>wrap</button>
      </div>
      <div ref={parentRef} className={`file-scroll ${wrap ? "wrap" : ""}`}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {items.map((vi) => {
            const content = html.get(vi.index) ?? " ";
            return (
              <div key={vi.key} className="diff-line ctx" style={{ transform: `translateY(${vi.start}px)` }}>
                <span className="diff-ln old">{vi.index + 1}</span>
                <span className="diff-code">
                  <span className="diff-code-text" dangerouslySetInnerHTML={{ __html: content }} />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ImageFile({ file, path }: { file: FileAtCommit; path: string }) {
  const src = `data:image/*;base64,${file.contentBase64}`;
  return (
    <div className="file-viewer">
      <div className="diff-toolbar">
        <span className="diff-path">{path}</span>
        <span className="dim">{formatBytes(file.size)}</span>
      </div>
      <div className="image-frame">
        <img src={src} alt={path} />
      </div>
    </div>
  );
}

export function FileViewer() {
  const repo = useReplay((s) => s.repo);
  const range = useReplay((s) => s.range);
  const index = useReplay((s) => s.index);
  const selectedFile = useReplay((s) => s.selectedFile);
  const setView = useReplay((s) => s.setView);
  const sha = range ? frameSha(range, index) : null;

  const file = useData(
    repo && sha && selectedFile ? `${repo.id}|${sha}|${selectedFile}` : null,
    () => getFileAtCommit(repo!.id, sha!, selectedFile!),
  );

  if (!selectedFile) {
    return <div className="empty-mini">Select a file to browse its content at this point in time.</div>;
  }
  if (file.loading || !file.data) {
    if (file.error) return <ErrorPanel error={file.error} />;
    return <Skeleton rows={14} />;
  }
  const f = file.data;

  return (
    <div className="snapshot-content">
      {f.kind === "text" && <TextFile file={f} path={f.path} />}
      {f.kind === "binary" &&
        (isLikelyImage(f.path) ? (
          <ImageFile file={f} path={f.path} />
        ) : (
          <div className="binary-note">
            <ImageIcon size={16} />
            <div>
              <strong>Binary file</strong>
              <p>{formatBytes(f.size)} — no preview available.</p>
            </div>
          </div>
        ))}
      {f.kind === "symlink" && (
        <div className="binary-note">
          <WarningIcon size={16} />
          <div>
            <strong>Symbolic link</strong>
            <p>Points to <code>{f.symlinkTarget}</code></p>
          </div>
        </div>
      )}
      {f.kind === "submodule" && (
        <div className="binary-note">
          <WarningIcon size={16} />
          <div>
            <strong>Submodule</strong>
            <p>Recorded commit: <code>{f.submoduleSha?.slice(0, 12)}</code></p>
          </div>
        </div>
      )}
      {(f.kind === "text" || f.kind === "binary") && (
        <button className="btn-ghost evolution-cta" onClick={() => setView("evolution")} title="Follow this file's evolution across the replay">
          <EvolutionIcon size={13} /> File evolution
        </button>
      )}
    </div>
  );
}
