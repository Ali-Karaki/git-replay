// The repository file tree at a frame. Content-addressed: subdirectories are
// listed by their tree object sha (shared across commits via the cache), and
// expansion state keys on the same sha so the tree stays open across frames.
// Very large directories render through a virtualizer (large-repo invariant).

import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getTree } from "../../lib/dataCaches";
import { useData } from "../../lib/useData";
import { frameSha, useReplay } from "../../stores/replay";
import type { FileChange, TreeEntry } from "../../lib/types";
import { ChevronDown, ChevronRight, FileIcon, FolderIcon, FolderOpenIcon } from "../../components/Icons";
import { Skeleton } from "../../components/States";

const VIRTUALIZE_THRESHOLD = 150;
const ROW_H = 25;

interface TreeNode {
  entry: TreeEntry;
  path: string;
  changed: FileChange | null;
}

function TreeRow({ node, depth, expanded, hasChanges, selected, onToggleDir, onSelectFile }: {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  hasChanges: boolean;
  selected: boolean;
  onToggleDir: (object: string) => void;
  onSelectFile: (path: string) => void;
}) {
  const { entry } = node;
  if (entry.kind === "tree") {
    return (
      <button
        className={`tree-row dir ${expanded ? "open" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onToggleDir(entry.object)}
      >
        <span className="tree-chevron">{expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
        <span className="tree-icon">{expanded ? <FolderOpenIcon size={14} /> : <FolderIcon size={14} />}</span>
        <span className="tree-name">{entry.name}</span>
        {hasChanges && <span className="tree-changed-dot" />}
      </button>
    );
  }
  const cls = node.changed ? `tree-row file status-${node.changed.status}` : "tree-row file";
  return (
    <button
      className={`${cls} ${selected ? "selected" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 + 16 }}
      onClick={() => onSelectFile(node.path)}
      title={entry.kind === "commit" ? `Submodule @ ${entry.object.slice(0, 7)}` : node.path}
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
}

function VirtualTree({ nodes, depth, changes, expandedDirs, selectedFile, onToggleDir, onSelectFile }: {
  nodes: TreeNode[];
  depth: number;
  changes: Map<string, FileChange>;
  expandedDirs: string[];
  selectedFile: string | null;
  onToggleDir: (object: string) => void;
  onSelectFile: (path: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 20,
  });
  return (
    <div ref={parentRef} style={{ maxHeight: 420, overflowY: "auto" }}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const node = nodes[vi.index];
          return (
            <div key={node.entry.object + node.path} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}>
              <TreeRow
                node={node}
                depth={depth}
                expanded={expandedDirs.includes(node.entry.object)}
                hasChanges={node.entry.kind === "tree" ? [...changes.keys()].some((p) => p.startsWith(node.path + "/")) : false}
                selected={selectedFile === node.path}
                onToggleDir={onToggleDir}
                onSelectFile={onSelectFile}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
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

  if (nodes.length > VIRTUALIZE_THRESHOLD) {
    return (
      <VirtualTree
        nodes={nodes}
        depth={depth}
        changes={changes}
        expandedDirs={expandedDirs}
        selectedFile={selectedFile}
        onToggleDir={toggleDir}
        onSelectFile={setSelectedFile}
      />
    );
  }

  return (
    <>
      {nodes.map((node) => {
        if (node.entry.kind === "tree") {
          const isOpen = expandedDirs.includes(node.entry.object);
          return (
            <div key={node.entry.object + node.path}>
              <TreeRow
                node={node}
                depth={depth}
                expanded={isOpen}
                hasChanges={[...changes.keys()].some((p) => p.startsWith(node.path + "/"))}
                selected={false}
                onToggleDir={toggleDir}
                onSelectFile={setSelectedFile}
              />
              {isOpen && (
                <TreeChildren treeish={node.entry.object} prefix={node.path} changes={changes} depth={depth + 1} />
              )}
            </div>
          );
        }
        return (
          <TreeRow
            key={node.entry.object + node.path}
            node={node}
            depth={depth}
            expanded={false}
            hasChanges={false}
            selected={selectedFile === node.path}
            onToggleDir={toggleDir}
            onSelectFile={setSelectedFile}
          />
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
