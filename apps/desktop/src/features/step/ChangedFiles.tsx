// The changed-files list for the current commit, with status glyphs and
// rename display.

import { basename, dirname, formatCount } from "../../lib/format";
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
  const files = detail.files;
  const selectedPath = selectedFile
    ? (files.find((f) => f.newPath === selectedFile || f.oldPath === selectedFile)?.newPath ?? null)
    : null;

  return (
    <div className="changed-files">
      <div className="panel-toolbar">
        <span className="panel-title">
          {files.length} file{files.length === 1 ? "" : "s"}
        </span>
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
