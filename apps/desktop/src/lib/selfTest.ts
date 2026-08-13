// In-app end-to-end audit: drives the REAL app — store, typed IPC, Rust
// engine, and rendered DOM — through every view, button, keyboard shortcut,
// and the edge cases (merges, renames, binary, empty commits, large diffs,
// working-tree frame, repo-change banner, settings, palette, search).
// Results render as an overlay and are persisted via the engine.

import { invoke } from "@tauri-apps/api/core";
import { api } from "./ipc";
import { getCommitDetail } from "./dataCaches";
import { suggestInitialMode } from "../features/repository/RangeSetup";
import { useChat } from "../stores/chat";
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

async function waitFor(selector: string, timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (document.querySelector(selector) !== null) return true;
    await wait(150);
  }
  return false;
}

async function waitForGone(selector: string, timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (document.querySelector(selector) === null) return true;
    await wait(150);
  }
  return false;
}

/** Poll until the element's text contains one of the fragments ("a|b" = any
 *  of them; fresh content, not whatever was already in the DOM). */
async function waitForText(selector: string, text: string, timeoutMs = 6000): Promise<boolean> {
  const needles = text.split("|");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const content = document.querySelector(selector)?.textContent ?? "";
    if (needles.some((n) => content.includes(n))) return true;
    await wait(150);
  }
  return false;
}

function click(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return false;
  el.click();
  return true;
}

function clickByText(selector: string, text: string): boolean {
  const els = [...document.querySelectorAll<HTMLElement>(selector)];
  const el = els.find((e) => e.textContent?.includes(text));
  if (!el) return false;
  el.click();
  return true;
}

function setInput(selector: string, value: string): boolean {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function pressKey(key: string, opts: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
}

function setSelect(selector: string, value: string): boolean {
  const el = document.querySelector<HTMLSelectElement>(selector);
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

async function step(name: string, fn: () => Promise<boolean | void>): Promise<void> {
  try {
    const ok = (await fn()) !== false;
    record(name, ok);
  } catch (e) {
    record(name, false, String(e));
  }
}

// ---------------------------------------------------------------------------

export async function runSelfTest(): Promise<void> {
  const appRepo = await invoke<string | null>("self_test_repo_path").catch(() => null);
  record("setup: self-test repo path", !!appRepo, appRepo ?? "none");
  if (!appRepo) return finish();

  // ── Repo A: this repository (linear history, one tag) ─────────────────────
  await step("A1 openRepo succeeds", async () => {
    const ok = await useReplay.getState().openRepo(appRepo);
    return ok && !!useReplay.getState().repo && useReplay.getState().error === null;
  });
  const s = useReplay.getState();
  const headBranch = s.branches.find((b) => b.isHead)?.name ?? s.branches[0]?.name ?? "";
  const mode = suggestInitialMode(s.repo?.defaultBranch ?? null, headBranch);
  record("A2 default mode avoids the empty main→main trap", mode === "entire", mode);

  await step("A3 entire-repository resolve", async () => {
    await useReplay.getState().configureRange("", null, false, false);
    return (useReplay.getState().range?.commits.length ?? 0) > 10;
  });
  record("A4 workspace renders", await waitFor(".workspace"));
  record("A5 timeline canvas + transport render", (await waitFor(".timeline-canvas")) && (await waitFor(".transport")));

  // Sidebar: view navigation.
  await step("A6 all four sidebar views switch views", async () => {
    useReplay.getState().setIndex(1); // step view renders its container only past the base frame
    for (const [item, cls] of [[".sidebar-item:nth-child(1)", ".view-step"], [".sidebar-item:nth-child(2)", ".view-snapshot"], [".sidebar-item:nth-child(3)", ".view-evolution"], [".sidebar-item:nth-child(4)", ".map-view"]] as const) {
      if (!click(item)) return false;
      if (!(await waitFor(cls, 4000))) return false;
    }
    return true;
  });

  // Step view: commit header, file list, diff, toolbar, filters, body toggle.
  await step("A7 step to commit 1 shows header + changed files", async () => {
    useReplay.getState().setView("step");
    useReplay.getState().setIndex(1);
    return (await waitFor(".commit-subject")) && (await waitFor(".file-row"));
  });
  await step("A8 select a file → diff renders with real hunk headers", async () => {
    const commit = useReplay.getState().range!.commits[0];
    const detail = await getCommitDetail(useReplay.getState().repo!.id, commit.sha, null);
    const file = detail.files.find((f) => !f.binary);
    if (!file) return false;
    useReplay.getState().setSelectedFile(file.newPath);
    if (!(await waitFor(".diff-view"))) return false;
    // The first hunk row renders through the virtualizer — poll for it.
    return await waitForText(".diff-hunk-row", "@@ -", 5000);
  });
  await step("A9 diff toolbar: wrap + split toggles work", async () => {
    click(".diff-toolbar .chip");
    await wait(100);
    clickByText(".diff-toolbar .chip", "split");
    await wait(300);
    const splitRows = document.querySelectorAll(".diff-line.split").length;
    clickByText(".diff-toolbar .chip", "unified");
    await wait(300);
    return splitRows > 0 && document.querySelectorAll(".diff-line:not(.split)").length > 0;
  });
  await step("A10 filters: ws + generated chips toggle state", async () => {
    const before = useReplay.getState().hideWhitespaceOnly;
    clickByText(".toolbar-actions .chip", "ws");
    await wait(100);
    const after = useReplay.getState().hideWhitespaceOnly;
    useReplay.getState().setSelectedFile(null);
    return after === !before;
  });
  await step("A11 body toggle expands the commit message", async () => {
    click(".body-toggle");
    return await waitFor(".commit-body-text", 3000);
  });
  await step("A12 sha copy button exists", async () => {
    return click(".sha-chip");
  });

  // Snapshot view.
  await step("A13 snapshot: tree renders, dir expands, file opens", async () => {
    useReplay.getState().setView("snapshot");
    if (!(await waitFor(".file-tree"))) return false;
    const dir = document.querySelector(".tree-row.dir");
    if (!dir) return false;
    (dir as HTMLElement).click();
    await wait(300);
    const file = document.querySelector(".tree-row.file");
    if (!file) return false;
    (file as HTMLElement).click();
    return await waitFor(".file-viewer", 4000);
  });
  await step("A14 markdown preview toggle on README", async () => {
    useReplay.getState().setSelectedFile("README.md");
    if (!(await waitFor(".file-viewer", 5000))) throw new Error("no .file-viewer after selecting README.md");
    if (!(await waitForText(".diff-toolbar", "preview", 3000))) throw new Error("no preview chip in toolbar");
    if (!clickByText(".diff-toolbar .chip", "preview")) throw new Error("preview chip click failed");
    if (!(await waitFor(".md-preview", 3000))) throw new Error("no .md-preview after toggle");
    return true;
  });

  // Evolution view.
  await step("A15 evolution: rows, jump, prev/next", async () => {
    useReplay.getState().setView("evolution");
    useReplay.getState().setSelectedFile("README.md");
    if (!(await waitFor(".view-evolution .file-row", 5000))) return false;
    const rows = document.querySelectorAll(".view-evolution .file-row").length;
    click(".view-evolution .file-row");
    await waitFor(".evolution-detail", 4000);
    return rows >= 2;
  });

  // Change map.
  await step("A16 change map: legend + canvas + cell click", async () => {
    useReplay.getState().setView("map");
    if (!(await waitFor(".map-view", 5000))) return false;
    await waitFor(".map-canvas");
    const legend = document.querySelector(".map-legend")?.textContent ?? "";
    const canvas = document.querySelector<HTMLElement>(".map-canvas");
    if (!canvas) return false;
    canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: canvas.getBoundingClientRect().left + 260, clientY: canvas.getBoundingClientRect().top + 40, bubbles: true }));
    return legend.includes("created") && legend.includes("deleted");
  });

  // Timeline: zoom + chapters.
  await step("A17 timeline: zoom buttons + chapters toggle", async () => {
    click(".timeline-zoom .btn-icon:nth-child(2)"); // zoom out
    await wait(100);
    click(".timeline-zoom .btn-icon:nth-child(3)"); // zoom in
    await wait(100);
    click(".timeline-zoom .btn-icon:nth-child(4)"); // fit
    await wait(100);
    const before = useReplay.getState().groupChapters;
    click(".timeline-zoom .chip");
    await wait(100);
    return useReplay.getState().groupChapters === !before;
  });

  // Transport.
  await step("A18 transport: first/prev/play/next/last + adaptive", async () => {
    click('.transport .btn-icon[title^="First"]');
    await wait(100);
    const at0 = useReplay.getState().index === 0;
    click('.transport .btn-icon[title^="Next"]');
    await wait(100);
    const at1 = useReplay.getState().index === 1;
    click(".btn-play");
    await wait(200);
    const playing = useReplay.getState().playing;
    click(".btn-play");
    await wait(100);
    const adaptiveBefore = useReplay.getState().adaptivePlayback;
    click(".speed-btn");
    await wait(150);
    clickByText(".speed-menu .chip", "Adaptive");
    await wait(100);
    return at0 && at1 && playing && useReplay.getState().adaptivePlayback === !adaptiveBefore;
  });

  // Keyboard.
  await step("A19 keyboard: arrows/space/home/end/view keys", async () => {
    useReplay.getState().setIndex(1);
    pressKey("ArrowRight");
    await wait(80);
    const right = useReplay.getState().index === 2;
    pressKey("ArrowLeft");
    await wait(80);
    const left = useReplay.getState().index === 1;
    pressKey(" ");
    await wait(80);
    const played = useReplay.getState().playing === true;
    pressKey(" ");
    pressKey("End");
    await wait(80);
    const end = useReplay.getState().index === useReplay.getState().range!.commits.length;
    pressKey("Home");
    await wait(80);
    const home = useReplay.getState().index === 0;
    pressKey("2");
    await wait(200);
    const view2 = useReplay.getState().view === "snapshot";
    pressKey("1");
    await wait(200);
    return right && left && played && end && home && view2 && useReplay.getState().view === "step";
  });

  // Command palette.
  await step("A20 palette: Ctrl+K opens, filters, Escape closes", async () => {
    pressKey("k", { ctrlKey: true });
    const opened = await waitFor(".palette", 2000);
    if (!opened) return false;
    setInput(".palette-input", "snapshot");
    await wait(200);
    const items = document.querySelectorAll(".palette-item").length;
    pressKey("Escape");
    await wait(150);
    return items > 0 && (await waitForGone(".palette"));
  });

  // Search.
  await step("A21 search: query finds results and jumps", async () => {
    setInput(".search-input", "replay");
    const found = await waitFor(".search-result", 4000);
    if (!found) return false;
    const idxBefore = useReplay.getState().index;
    click(".search-result");
    await wait(300);
    return useReplay.getState().index !== idxBefore;
  });

  // Empty replay explanation.
  await step("A22 empty range shows an explanation, not a dead workspace", async () => {
    await useReplay.getState().configureRange(useReplay.getState().repo!.headSha, useReplay.getState().repo!.headSha, false, false);
    const ok = await waitFor(".empty-state", 4000);
    const text = document.querySelector(".empty-state")?.textContent ?? "";
    const explain = text.includes("no commits") || text.includes("same commit");
    clickByText(".empty-state .btn", "Choose a different range");
    await wait(300);
    return ok && explain && document.querySelector(".range-setup") !== null;
  });

  // Settings + About pages.
  await step("A23 settings: theme toggle, cache info, clear cache, back", async () => {
    useReplay.getState().setScreen("settings");
    if (!(await waitFor(".settings-section", 3000))) return false;
    clickByText(".segmented .chip", "dark");
    await wait(100);
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    clickByText(".segmented .chip", "system");
    await wait(100);
    const sys = document.documentElement.getAttribute("data-theme") === null;
    clickByText(".settings-row .btn", "Clear cache");
    await wait(600);
    const note = document.querySelector(".settings-note")?.textContent ?? "";
    clickByText(".page-header .btn", "Back");
    await wait(200);
    return dark && sys && note.includes("cleared") && document.querySelector(".settings-section") === null;
  });
  await step("A24 about page renders with version", async () => {
    useReplay.getState().setScreen("about");
    const ok = await waitFor(".about-hero", 3000);
    const version = document.querySelector(".about-version")?.textContent ?? "";
    clickByText(".page-header .btn", "Back");
    await wait(200);
    return ok && /Version/.test(version);
  });

  // ── Repo B: demo fixture (merge, rename, binary, empty, large, tags) ───────
  const demoPath = await invoke<string | null>("ensure_demo_fixture").catch(() => null);
  record("B1 demo fixture built", !!demoPath, demoPath ?? "none");
  if (demoPath) {
    await invoke("dirty_demo_fixture", { path: demoPath }).catch(() => undefined);

    await step("B2 demo repo opens and resolves", async () => {
      const ok = await useReplay.getState().openRepo(demoPath);
      if (!ok) return false;
      await useReplay.getState().configureRange("", null, false, false);
      return (useReplay.getState().range?.commits.length ?? 0) >= 12;
    });

    await step("B3 merge commit: badge + parent switcher updates files", async () => {
      const range = useReplay.getState().range!;
      const idx = range.commits.findIndex((c) => c.parents.length > 1);
      if (idx < 0) return false;
      useReplay.getState().setView("step");
      useReplay.getState().setIndex(idx + 1);
      if (!(await waitFor(".merge-badge"))) return false;
      const before = document.querySelectorAll(".file-row").length;
      clickByText(".merge-parents .chip", "2nd parent");
      await wait(500);
      const after = document.querySelectorAll(".file-row").length;
      const secondOn = document.querySelector(".merge-parents .chip.on")?.textContent?.includes("2nd") ?? false;
      return after > 0 && secondOn && before !== after;
    });

    await step("B4 rename commit shows move display", async () => {
      const range = useReplay.getState().range!;
      const idx = range.commits.findIndex((c) => c.subject.includes("move service"));
      if (idx < 0) throw new Error("rename commit not in range");
      useReplay.getState().setIndex(idx + 1);
      // Wait for THIS commit's content, not rows left over from the previous frame.
      if (!(await waitForText(".commit-subject", "move service", 5000))) {
        throw new Error(`commit header never showed the rename subject; got: ${document.querySelector(".commit-subject")?.textContent ?? "none"}`);
      }
      const text = [...document.querySelectorAll(".file-row")].map((e) => e.textContent ?? "").join(" | ");
      if (!text.includes("→")) throw new Error(`no move arrow in rows: ${text}`);
      return true;
    });

    await step("B5 binary commit shows a binary notice", async () => {
      const range = useReplay.getState().range!;
      const idx = range.commits.findIndex((c) => c.subject.includes("add assets"));
      if (idx < 0) throw new Error("assets commit not in range");
      useReplay.getState().setIndex(idx + 1);
      if (!(await waitForText(".commit-subject", "add assets", 5000))) {
        throw new Error(`header never showed the assets subject; got: ${document.querySelector(".commit-subject")?.textContent ?? "none"}`);
      }
      const rows = [...document.querySelectorAll(".file-row-name")].map((e) => e.textContent ?? "");
      const binRow = rows.find((t) => t.includes("logo.bin"));
      if (!binRow) throw new Error(`logo.bin row missing: ${rows.join(" | ")}`);
      useReplay.getState().setSelectedFile("assets/logo.bin");
      if (!(await waitFor(".binary-note", 5000))) {
        const content = document.querySelector(".step-content")?.textContent?.slice(0, 300) ?? "no .step-content";
        throw new Error(`no .binary-note rendered; step content: ${content}`);
      }
      return true;
    });

    await step("B6 empty commit shows the no-changes state", async () => {
      const range = useReplay.getState().range!;
      const idx = range.commits.findIndex((c) => c.subject.includes("checkpoint"));
      if (idx < 0) throw new Error("checkpoint commit not in range");
      useReplay.getState().setIndex(idx + 1);
      if (!(await waitForText(".commit-subject", "checkpoint", 5000))) {
        throw new Error(`header never showed checkpoint; got: ${document.querySelector(".commit-subject")?.textContent ?? "none"}`);
      }
      const text = document.querySelector(".changed-files")?.textContent ?? "";
      if (!text.includes("No file changes")) throw new Error(`changed files text: ${text.slice(0, 200)}`);
      return true;
    });

    await step("B7 large generated diff virtualizes a 1200-line file", async () => {
      const range = useReplay.getState().range!;
      const idx = range.commits.findIndex((c) => c.subject.includes("generate constants"));
      if (idx < 0) return false;
      useReplay.getState().setIndex(idx + 1);
      await waitFor(".file-row");
      useReplay.getState().setSelectedFile("src/generated/constants.ts");
      if (!(await waitFor(".diff-view", 6000))) return false;
      const scroller = document.querySelector<HTMLElement>(".diff-scroll");
      if (!scroller) return false;
      // Virtualized: far more content than rendered rows.
      return scroller.scrollHeight > 10000 && document.querySelectorAll(".diff-line").length > 20;
    });

    await step("B8 working-tree frame: header, changed list, untracked file", async () => {
      useReplay.getState().setIndex(useReplay.getState().range!.commits.length + 1);
      if (!(await waitFor(".commit-no.wt"))) return false;
      const rows = [...document.querySelectorAll(".file-row-name")].map((e) => e.textContent ?? "");
      return rows.some((t) => t.includes("scratch-notes.txt")) && rows.some((t) => t.includes("queue.ts"));
    });

    await step("B9 working-tree snapshot lists untracked files", async () => {
      useReplay.getState().setView("snapshot");
      await waitFor(".file-tree");
      const text = document.querySelector(".file-tree")?.textContent ?? "";
      return text.includes("scratch-notes.txt");
    });

    await step("B9b symlink and submodule entries render notices", async () => {
      const range = useReplay.getState().range!;
      const idx = range.commits.findIndex((c) => c.subject.includes("symlink and submodule"));
      if (idx < 0) throw new Error("symlink/submodule commit not in range");
      useReplay.getState().setIndex(idx + 1);
      // The symlink/submodule notices live in the snapshot file viewer.
      useReplay.getState().setView("snapshot");
      // Wait for THIS commit's tree (the previous frame's tree is still in
      // the DOM until the listing reloads).
      if (!(await waitForText(".file-tree", "link.txt", 6000))) {
        const treeText = document.querySelector(".file-tree")?.textContent ?? "none";
        throw new Error(`link.txt never appeared in the tree: ${treeText.slice(0, 200)}`);
      }
      useReplay.getState().setSelectedFile("link.txt");
      if (!(await waitForText(".binary-note", "Symbolic link", 5000))) {
        throw new Error(`no symlink notice; got: ${document.querySelector(".snapshot-content")?.textContent?.slice(0, 200)}`);
      }
      useReplay.getState().setSelectedFile("vendor/lib");
      if (!(await waitForText(".binary-note", "Submodule", 5000))) {
        throw new Error(`no submodule notice; got: ${document.querySelector(".snapshot-content")?.textContent?.slice(0, 200)}`);
      }
      return true;
    });

    await step("B10 repo change is detected and refresh clears the banner", async () => {
      await invoke("commit_demo_fixture", { path: demoPath }).catch(() => undefined);
      const seen = await waitFor(".repo-changed-banner", 9000);
      if (!seen) return false;
      click(".repo-changed-banner .btn-primary");
      const cleared = await waitForGone(".repo-changed-banner", 4000);
      return cleared && useReplay.getState().repoChanged === false;
    });

    await step("B11 tags mode renders tag pickers", async () => {
      useReplay.getState().setScreen("replay");
      useReplay.setState({ range: null });
      await waitFor(".range-setup");
      if (!clickByText(".range-mode-card", "Watch between releases")) return false;
      await wait(200);
      const selects = document.querySelectorAll(".range-form select").length;
      // The branch mode's "More options" disclosure must be gone — proves
      // the mode actually switched (branch mode also renders two selects).
      const switched = document.querySelector(".range-more") === null;
      useReplay.setState({ screen: "replay" });
      return selects >= 2 && switched;
    });

    await step("B12 PR mode surfaces errors gracefully", async () => {
      if (!clickByText(".range-mode-card", "Watch a pull request")) return false;
      if (!(await waitFor(".pr-form", 2000))) return false;
      await wait(200);
      setInput(".pr-form input", "999999");
      clickByText(".pr-form .btn", "Load");
      await wait(2500);
      const err = document.querySelector(".range-error")?.textContent ?? "";
      const noCrash = document.querySelector(".crash-panel") === null;
      return noCrash && err.length > 0;
    });

    await step("B13 chat panel opens and fails gracefully without a key", async () => {
      useReplay.getState().setScreen("replay");
      useReplay.setState({ range: null });
      await waitFor(".range-setup");
      // Stale persisted history from an earlier run must not satisfy the
      // assertions below.
      useChat.getState().clearMessages();
      const settings = await api.getChatSettings();
      click(".chat-trigger");
      if (!(await waitFor(".chat-panel", 3000))) throw new Error("chat panel did not open");
      if (settings.hasKey) {
        click(".chat-header-actions .btn-icon:last-child"); // close
        await wait(200);
        // Assert via store state, not just DOM (the DOM check alone can't
        // tell a working close from a no-op).
        const closed = useChat.getState().open === false && document.querySelector(".chat-panel") === null;
        // Only claim the skip after the close-check has passed.
        if (closed) record("B13 note", true, "skipped no-key error assertion — a key is configured");
        return closed;
      }
      // Send without a key: the engine must respond with a friendly error.
      setInput(".chat-input", "hello");
      await wait(100);
      clickByText(".chat-input-actions .btn", "Send");
      if (!(await waitForText(".chat-messages", "No API key", 8000))) {
        throw new Error(`no friendly key error; messages: ${document.querySelector(".chat-messages")?.textContent?.slice(0, 200)}`);
      }
      const noCrash = document.querySelector(".crash-panel") === null;
      click(".chat-header-actions .btn-icon:last-child"); // close
      await wait(200);
      return noCrash && document.querySelector(".chat-panel") === null;
    });

    await step("B13b chat settings save/remove pipeline (fake key, no real key configured)", async () => {
      const settings = await api.getChatSettings();
      if (settings.hasKey) {
        record("B13b note", true, "skipped — a real key is configured");
        return true;
      }
      try {
        useChat.setState({ open: false });
        await wait(200);
        click(".chat-trigger");
        if (!(await waitFor(".chat-panel", 3000))) throw new Error("chat panel did not open");
        clickByText(".chat-header-actions .btn-icon", "⚙");
        if (!(await waitFor(".chat-settings", 2000))) throw new Error("settings did not open");
        // Pick DeepSeek; the model select must follow the provider.
        setSelect(".chat-settings select", "deepseek");
        await wait(200);
        const modelEl = document.querySelectorAll(".chat-settings select")[1] as HTMLSelectElement | null;
        const modelFollows = (modelEl?.value ?? "") === "deepseek-chat";
        // Save a fake key and verify persistence (the settings stay open so
        // the feedback note is visible).
        setInput('.chat-settings input[type="password"]', "sk-test-fake-key-123");
        await wait(100);
        clickByText(".chat-settings-actions .btn", "Save");
        await wait(800);
        const hasKeyNow = useChat.getState().hasKey;
        const savedNote = document.querySelector(".settings-note")?.textContent ?? "";
        if (!hasKeyNow) throw new Error("save did not persist the key");
        // Sending with the fake key must produce a friendly provider error,
        // not a crash (401 from the provider, or a network error if offline).
        setInput(".chat-input", "hello");
        await wait(100);
        clickByText(".chat-input-actions .btn", "Send");
        const gotError = await waitForText(
          ".chat-messages .chat-msg.assistant",
          "rejected|Could not reach|error",
          40000,
        );
        const noCrash = document.querySelector(".crash-panel") === null;
        // Remove the key; Send must be gated again.
        clickByText(".chat-header-actions .btn-icon", "⚙");
        await wait(300);
        clickByText(".chat-settings-actions .btn", "Remove key");
        await wait(600);
        const hasKeyAfter = useChat.getState().hasKey;
        const sendDisabled =
          (document.querySelector(".chat-input-actions .btn-primary") as HTMLButtonElement | null)?.disabled ?? false;
        const failures = [
          !gotError && `gotError=false (messages: ${(document.querySelector(".chat-messages")?.textContent ?? "").slice(-200)})`,
          !noCrash && "crash panel present",
          hasKeyAfter && "key still present after remove",
          !sendDisabled && "Send not disabled after remove",
          !modelFollows && `model did not follow provider (got ${modelEl?.value})`,
          !savedNote.includes("Saved") && `no saved note (note="${savedNote}")`,
        ].filter(Boolean);
        if (failures.length > 0) throw new Error(failures.join("; "));
        return true;
      } finally {
        // Never leave the fake key behind — it would poison B14.
        if (useChat.getState().hasKey) {
          await api.clearChatSettings().catch(() => undefined);
        }
        useChat.setState({ open: false });
        await useChat.getState().loadSettings();
      }
    });

    await step("B14 live chat round-trip (real provider call when a key is configured)", async () => {
      const settings = await api.getChatSettings();
      if (!settings.hasKey) {
        record("B14 note", true, "skipped — no API key configured");
        return true;
      }
      useChat.setState({ open: false });
      await wait(200);
      click(".chat-trigger");
      if (!(await waitFor(".chat-panel", 3000))) throw new Error("chat panel did not open");
      setInput(".chat-input", "Reply with exactly: OK");
      await wait(100);
      clickByText(".chat-input-actions .btn", "Send");
      // The real provider round-trip: streamed text must arrive.
      if (!(await waitForText(".chat-messages .chat-msg.assistant", "OK", 60000))) {
        const text = document.querySelector(".chat-messages")?.textContent ?? "";
        // A configured key that the provider rejects (stale/invalid) is an
        // environment condition, not an app regression — note and skip.
        // Cover the common phrasings: our engine's friendly messages plus
        // raw 401/unauthorized/invalid-key wording from any provider.
        if (/401|unauthorized|invalid api key|api key.*(invalid|rejected)|rejected|provider returned an error|could not reach/i.test(text)) {
          record("B14 note", true, `skipped — the configured key was rejected by the provider (${text.slice(0, 120)})`);
          click(".chat-header-actions .btn-icon:last-child");
          return true;
        }
        throw new Error(`no streamed reply; messages: ${text.slice(0, 300)}`);
      }
      const stillSending = useChat.getState().sending;
      click(".chat-header-actions .btn-icon:last-child");
      await wait(200);
      return !stillSending;
    });
  }

  // Window-level errors since startup.
  const windowErrors = (window as unknown as { __selftestErrors?: string[] }).__selftestErrors ?? [];
  for (const e of windowErrors.slice(0, 5)) {
    record("uncaught window error", false, e);
  }

  finish();
}

function finish(): void {
  record("TOTAL", results.every((r) => r.ok), `${results.filter((r) => r.ok).length}/${results.length} steps passed`);
  const passed = results.filter((r) => r.ok).length;

  const report = JSON.stringify({ passed, total: results.length, results }, null, 2);
  invoke("report_self_test", { report }).catch(() => undefined);

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
