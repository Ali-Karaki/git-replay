// In-app end-to-end self-test: drives the REAL app — the store, the typed IPC
// layer, the Rust engine, and the rendered DOM — through the full open →
// replay → step → snapshot → evolution → search flow. Results render as an
// overlay and are persisted via the engine (stdout + cache dir file).

import { invoke } from "@tauri-apps/api/core";
import { api } from "./ipc";
import { getCommitDetail, getFileDiff, getFileAtCommit, getTree } from "./dataCaches";
import { suggestInitialMode } from "../features/repository/RangeSetup";
import { useReplay } from "../stores/replay";

interface TestResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: TestResult[] = [];

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail: detail.slice(0, 400) });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll for a selector instead of assuming a fixed delay is enough. */
async function waitFor(selector: string, timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (document.querySelector(selector) !== null) return true;
    await wait(150);
  }
  return false;
}


export async function runSelfTest(): Promise<void> {
  try {
    const path = await invoke<string | null>("self_test_repo_path");
    record("engine: self-test repo path resolved", !!path, path ?? "none");
    if (!path) throw new Error("no self-test repo path");

    // 1. Open the repository through the exact store action the UI uses.
    const opened = await useReplay.getState().openRepo(path);
    const s = useReplay.getState();
    record("store: openRepo succeeds", opened && !!s.repo, s.error ?? "");
    if (!s.repo) throw new Error("open failed");

    // 2. Default mode suggestion must avoid the empty main→main replay.
    const headBranch = s.branches.find((b) => b.isHead)?.name ?? s.branches[0]?.name ?? "";
    const mode = suggestInitialMode(s.repo.defaultBranch, headBranch);
    record("range setup: default mode suggested", mode === "branch" || mode === "entire", mode);

    // 3. Resolve the entire repository (the flow the default leads to).
    await useReplay.getState().configureRange("", null, false, false);
    const after = useReplay.getState();
    const frames = after.range?.commits.length ?? 0;
    record("engine: entire-repository replay resolves with history", frames > 10, `${frames} commits`);

    // 4. The workspace must actually render (this catches render crashes).
    record("UI renders: workspace", await waitFor(".workspace"), ".workspace appeared");
    record("UI renders: timeline canvas", await waitFor(".timeline-canvas"), ".timeline-canvas appeared");
    record("UI renders: transport controls", await waitFor(".transport"), ".transport appeared");

    // 5. Step to the first commit; its detail + a real diff must load.
    // (Persisted preferences may leave any view active — pin the step view.)
    useReplay.getState().setView("step");
    useReplay.getState().setIndex(1);
    const commit = useReplay.getState().range!.commits[0];
    const detail = await getCommitDetail(s.repo.id, commit.sha, null);
    record("engine: first commit detail loads", detail.files.length > 0, `${detail.files.length} files`);
    record("UI renders: commit header", await waitFor(".commit-subject"), ".commit-subject appeared after stepping");
    const firstFile = detail.files.find((f) => !f.binary);
    if (firstFile) {
      useReplay.getState().setSelectedFile(firstFile.newPath);
      const diff = await getFileDiff(s.repo.id, commit.sha, firstFile.newPath, null);
      record("engine: file diff loads", !!diff.patch || diff.binary, diff.patch ? "patch" : "binary");
      record("UI renders: diff view", await waitFor(".diff-view"), ".diff-view appeared after selecting a file");
    } else {
      record("engine: file diff loads", false, "no text file in first commit");
    }

    // 6. Snapshot browsing at HEAD.
    useReplay.getState().setIndex(frames);
    useReplay.getState().setView("snapshot");
    record("UI renders: snapshot file tree", await waitFor(".file-tree"), ".file-tree appeared");
    const tree = await getTree(s.repo.id, useReplay.getState().range!.headSha);
    record("engine: snapshot tree at HEAD", tree.length > 0, `${tree.length} root entries`);
    const readme = await getFileAtCommit(s.repo.id, useReplay.getState().range!.headSha, "README.md");
    record("engine: file content at HEAD", !!readme.content && readme.content.length > 0, `${readme.size} bytes`);

    // 7. File evolution for a known frequently-touched file.
    const evo = await api.getFileEvolution(s.repo.id, useReplay.getState().range!.baseSha, useReplay.getState().range!.headSha, "README.md");
    record("engine: file evolution", evo.length > 0, `${evo.length} changes`);

    // 8. Search across the replay.
    const hits = await api.searchReplay(s.repo.id, useReplay.getState().range!.baseSha, useReplay.getState().range!.headSha, "replay", 10);
    record("engine: replay search", hits.length > 0, `${hits.length} hits`);

    // 9. Change map view renders.
    useReplay.getState().setView("map");
    record("UI renders: change map", await waitFor(".map-view"), ".map-view appeared");

    // 10. Working-tree frame: the repo's worktree may be dirty; the command
    //     must at least succeed and shape the frame.
    const wt = await api.getWorkingTree(s.repo.id);
    record("engine: working tree frame", Array.isArray(wt.files), `${wt.files.length} changed, ${wt.untracked} untracked`);

    // 11. Settings page renders.
    useReplay.getState().setScreen("settings");
    record("UI renders: settings page", await waitFor(".settings-section"), ".settings-section appeared");
    useReplay.getState().setScreen("replay");
  } catch (e) {
    record("self-test harness", false, String(e));
  }

  // Anything the window logged as an uncaught error/rejection since startup.
  const windowErrors = (window as unknown as { __selftestErrors?: string[] }).__selftestErrors ?? [];
  for (const e of windowErrors.slice(0, 5)) {
    record("uncaught window error", false, e);
  }

  record("TOTAL", results.every((r) => r.ok), `${results.filter((r) => r.ok).length}/${results.length} steps passed`);
  const passed = results.filter((r) => r.ok).length;

  const report = JSON.stringify({ passed, total: results.length, results }, null, 2);
  try {
    await invoke("report_self_test", { report });
  } catch {
    // Reporting is best-effort; the overlay still shows.
  }

  renderOverlay(results, passed);
}

function renderOverlay(results: TestResult[], passed: number) {
  const overlay = document.createElement("div");
  overlay.className = "selftest-overlay";
  overlay.innerHTML = `
    <div class="selftest-card">
      <h2>Self-test ${passed === results.length ? "✓ passed" : "✗ FAILED"} — ${passed}/${results.length}</h2>
      <ul>${results.map((r) => `<li class="${r.ok ? "ok" : "fail"}"><b>${r.ok ? "✓" : "✗"}</b> ${r.name}${r.detail ? `<span class="dim"> — ${r.detail}</span>` : ""}</li>`).join("")}</ul>
      <button class="btn">Close</button>
    </div>`;
  overlay.querySelector("button")!.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}
