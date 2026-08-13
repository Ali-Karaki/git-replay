// The repository file tree at a frame. Content-addressed: subdirectories are
// listed by their tree object sha (shared across commits via the cache), and
// expansion state keys on the same sha so the tree stays open across frames.

import { useMemo } from "react";
import { getTree } from "../../lib/dataCaches";
import { useData } from "../../lib/useData";
import { frameSha, useReplay } from "../../stores/replay";
import type { FileChange, TreeEntry } from "../../lib/types";
import { ChevronDown, ChevronRight, FileIcon, FolderIcon, FolderOpenIcon } from "../../components/Icons";
import { Skeleton } from "../../components/States";

interface TreeNode {
  entry: TreeEntry;
  path: string;
  changed: FileChange | null;
}

function TreeChildren({ treeish, prefix, changes, depth }: {
  treeish: string;
  prefix: string;
  changes: Map<string, FileChange>;
  depth: number;
}) {
  const repo = useReplay((s) => s.repo);
  const expandedDirs = useReplay((s) => s.expandedDirs);
  const selectedFile = useReplay((s) => s.selectedFile);
  const setSelectedFile = useReplay((s) => s.setSelectedFile);
  const toggleDir = useReplay((s) => s.toggleDir);

  const listing = useData(repo ? `${repo.id}|${treeish}` : null, () => getTree(repo!.id, treeish));

  const nodes: TreeNode[] = useMemo(() => {
    if (!listing.data) return [];
    const dirs = listing.data.filter((e) => e.kind === "tree").sort((a, b) => a.name.localeCompare(b.name));
    const files = listing.data.filter((e) => e.kind !== "tree").sort((a, b) => a.name.localeCompare(b.name));
    return [...dirs, ...files].map((entry) => ({
      entry,
      path: prefix ? `${prefix}/${entry.name}` : entry.name,
      changed: changes.get(prefix ? `${prefix}/${entry.name}` : entry.name) ?? null,
    }));
  }, [listing.data, prefix, changes]);

  if (listing.loading && !listing.data) return <div className="tree-loading"><Skeleton rows={5} /></div>;
  if (listing.error) return <div className="dim tree-error">{listing.error.message}</div>;

  return (
    <>
      {nodes.map((node) => {
        const { entry } = node;
        if (entry.kind === "tree") {
          const isOpen = expandedDirs.includes(entry.object);
          const fullPath = node.path;
          const hasChanges = [...changes.keys()].some((p) => p.startsWith(fullPath + "/"));
          return (
            <div key={entry.object + fullPath}>
              <button
                className={`tree-row dir ${isOpen ? "open" : ""}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => toggleDir(entry.object)}
              >
                <span className="tree-chevron">{isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
                <span className="tree-icon">{isOpen ? <FolderOpenIcon size={14} /> : <FolderIcon size={14} />}</span>
                <span className="tree-name">{entry.name}</span>
                {hasChanges && <span className="tree-changed-dot" />}
              </button>
              {isOpen && (
                <TreeChildren treeish={entry.object} prefix={fullPath} changes={changes} depth={depth + 1} />
              )}
            </div>
          );
        }
        const fullPath = node.path;
        const cls = node.changed ? `tree-row file status-${node.changed.status}` : "tree-row file";
        return (
          <button
            key={entry.object + fullPath}
            className={`${cls} ${selectedFile === fullPath ? "selected" : ""}`}
            style={{ paddingLeft: 8 + depth * 14 + 16 }}
            onClick={() => setSelectedFile(fullPath)}
            title={entry.kind === "commit" ? `Submodule @ ${entry.object.slice(0, 7)}` : fullPath}
          >
            <span className={`tree-icon ${entry.kind === "commit" ? "submodule" : ""}`}>
              <FileIcon size={14} />
            </span>
            <span className="tree-name">{entry.name}</span>
            {entry.mode === "120000" && <span className="ws-tag" title="Symlink">ln</span>}
            {entry.kind === "commit" && <span className="ws-tag" title="Submodule">sub</span>}
            {node.changed && <span className={`tree-status status-${node.changed.status}`}>{node.changed.status[0].toUpperCase()}</span>}
          </button>
        );
      })}
    </>
  );
}

export function FileTree({ changes }: { changes: FileChange[] }) {
  const range = useReplay((s) => s.range);
  const index = useReplay((s) => s.index);
  const hasWorkingTree = useReplay((s) => s.hasWorkingTree);
  const sha = range ? frameSha(range, index, hasWorkingTree) : null;
  const changeMap = useMemo(() => {
    const m = new Map<string, FileChange>();
    for (const c of changes) m.set(c.newPath, c);
    return m;
  }, [changes]);

  if (!sha) return null;
  return (
    <div className="file-tree">
      <TreeChildren treeish={sha === "WORKTREE" ? "wt:" : sha} prefix="" changes={changeMap} depth={0} />
    </div>
  );
}
