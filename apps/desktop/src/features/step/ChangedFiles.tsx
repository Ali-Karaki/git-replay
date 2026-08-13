// The changed-files list for the current commit, with status glyphs, rename
// display, and the generated/whitespace filters.

import { FilterIcon } from "../../components/Icons";
import { basename, dirname, formatCount, isGeneratedPath } from "../../lib/format";
import type { CommitDetail, FileChange } from "../../lib/types";
import { useReplay } from "../../stores/replay";

function statusClass(status: FileChange["status"]): string {
  return `status-${status}`;
}

function FileRow({ file, selected, onSelect }: { file: FileChange; selected: boolean; onSelect: () => void }) {
  const path = file.newPath;
  const name = basename(path);
  const dir = dirname(path);
  return (
    <button type="button" className={`file-row ${selected ? "selected" : ""}`} onClick={onSelect} title={path}>
      <span className={`status-dot ${statusClass(file.status)}`} />
      <span className="file-row-name">
        {file.status === "renamed" || file.status === "copied" ? (
          <>
            <span className="dim">{file.oldPath}</span>
            <span className="arrow"> → </span>
            <span>{path}</span>
          </>
        ) : (
          <>
            {dir && <span className="dim">{dir}/</span>}
            <span>{name}</span>
          </>
        )}
        {file.whitespaceOnly && (
          <span className="ws-tag" title="Whitespace-only change">
            ws
          </span>
        )}
        {file.binary && (
          <span className="ws-tag" title="Binary file">
            bin
          </span>
        )}
      </span>
      <span className="file-row-stats">
        {file.additions > 0 && <span className="add">+{formatCount(file.additions)}</span>}
        {file.deletions > 0 && <span className="del">−{formatCount(file.deletions)}</span>}
        {file.similarity !== null && (
          <span className="dim" title={`${file.similarity}% similar`}>
            {file.similarity}%
          </span>
        )}
      </span>
    </button>
  );
}

export function ChangedFiles({ detail }: { detail: CommitDetail }) {
  const selectedFile = useReplay((s) => s.selectedFile);
  const setSelectedFile = useReplay((s) => s.setSelectedFile);
  const hideGenerated = useReplay((s) => s.hideGenerated);
  const hideWhitespaceOnly = useReplay((s) => s.hideWhitespaceOnly);
  const set = useReplay.setState;

  let files = detail.files;
  let hidden = 0;
  if (hideGenerated || hideWhitespaceOnly) {
    files = files.filter((f) => {
      if (hideWhitespaceOnly && f.whitespaceOnly) {
        hidden++;
        return false;
      }
      if (hideGenerated && (isGeneratedPath(f.newPath) || (f.oldPath && isGeneratedPath(f.oldPath)))) {
        hidden++;
        return false;
      }
      return true;
    });
  }

  const selectedPath = selectedFile
    ? (detail.files.find((f) => f.newPath === selectedFile || f.oldPath === selectedFile)?.newPath ?? null)
    : null;

  return (
    <div className="changed-files">
      <div className="panel-toolbar">
        <span className="panel-title">
          {detail.files.length} file{detail.files.length === 1 ? "" : "s"}
          {hidden > 0 && <span className="dim"> · {hidden} hidden</span>}
        </span>
        <div className="toolbar-actions">
          <button
            type="button"
            className={`chip ${hideWhitespaceOnly ? "on" : ""}`}
            onClick={() => set({ hideWhitespaceOnly: !hideWhitespaceOnly })}
            title="Hide whitespace-only changes"
          >
            ws
          </button>
          <button
            type="button"
            className={`chip ${hideGenerated ? "on" : ""}`}
            onClick={() => set({ hideGenerated: !hideGenerated })}
            title="Hide generated files and lockfiles"
          >
            <FilterIcon size={12} /> generated
          </button>
        </div>
      </div>
      <div className="file-list">
        {files.length === 0 ? (
          <div className="empty-mini">No file changes in this commit.</div>
        ) : (
          files.map((f) => (
            <FileRow
              key={f.newPath}
              file={f}
              selected={f.newPath === selectedPath}
              onSelect={() => setSelectedFile(f.newPath)}
            />
          ))
        )}
      </div>
    </div>
  );
}
