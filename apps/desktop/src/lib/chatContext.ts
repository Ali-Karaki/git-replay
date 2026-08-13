// Builds the CONTEXT block attached to a chat question: what the user is
// looking at right now — replay range, current frame, changed files, and the
// selected file's diff (capped). Only ever sent when the user asks.

import { getCachedCommitDetail, getCommitDetail, getFileDiff } from "./dataCaches";
import { frameSha, useReplay } from "../stores/replay";

const DIFF_CAP = 6000;
const FILES_CAP = 40;
const BODY_CAP = 800;

export async function buildChatContext(): Promise<string> {
  const s = useReplay.getState();
  const lines: string[] = [];
  if (!s.range || !s.repo) {
    return "No repository is open.";
  }
  lines.push(`Repository: ${s.repo.path}`);
  lines.push(
    `Replay range: ${s.range.baseSha.slice(0, 7)} → ${s.range.headSha.slice(0, 7)} (${s.range.commits.length} commits)`,
  );

  const sha = frameSha(s.range, s.index, s.hasWorkingTree);
  if (s.index === 0) {
    lines.push(`Current frame: BASE snapshot (${sha.slice(0, 7)})`);
  } else if (sha === "WORKTREE") {
    lines.push(`Current frame: Working Tree (uncommitted changes vs ${s.range.headSha.slice(0, 7)})`);
  } else {
    const commit = s.range.commits[Math.min(s.index - 1, s.range.commits.length - 1)];
    lines.push(
      `Current frame: commit ${s.index}/${s.range.commits.length} — ${sha.slice(0, 7)} "${commit.subject}" by ${commit.author.name}`,
    );
    if (commit.body) lines.push(`Commit body: ${commit.body.slice(0, BODY_CAP)}`);
    // The selected merge parent only applies to merge commits.
    const parentIndex = commit.parents.length > 1 ? s.mergeParent : null;
    const detail =
      getCachedCommitDetail(s.repo.id, sha, parentIndex) ??
      (await getCommitDetail(s.repo.id, sha, parentIndex).catch(() => null));
    if (detail) {
      lines.push(
        `Changed files (${detail.stats.filesChanged} files, +${detail.stats.insertions} −${detail.stats.deletions}):`,
      );
      for (const f of detail.files.slice(0, FILES_CAP)) {
        lines.push(
          `- ${f.status} ${f.oldPath ? `${f.oldPath} → ` : ""}${f.newPath}${f.binary ? " (binary)" : ""}`,
        );
      }
      if (s.selectedFile) {
        const diff = await getFileDiff(
          s.repo.id,
          sha,
          s.selectedFile,
          detail.meta.parents.length > 1 ? s.mergeParent : null,
        ).catch(() => null);
        lines.push(`Selected file diff (${s.selectedFile}):`);
        lines.push(diff?.patch ? diff.patch.slice(0, DIFF_CAP) : "(binary file or no diff)");
      }
    }
  }
  return lines.join("\n");
}
