// UI / playback state (Zustand). Repository data lives in the Rust engine and
// the module-level query caches — never in global React state (spec §32).

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { clearCaches } from "../lib/dataCaches";
import { api } from "../lib/ipc";
import { nextZoomIn, nextZoomOut } from "../lib/timelineModel";
import type { BranchInfo, HeadState, PrReplay, ReplayRange, RepoInfo, TagInfo, WorkingTreeFrame } from "../lib/types";

export type ViewMode = "step" | "snapshot" | "evolution";
export type Theme = "system" | "light" | "dark";
export type DiffMode = "unified" | "split";
export type Screen = "replay" | "settings" | "about";

/** Session snapshot persisted for "Resume last replay" (spec 40). */
interface SavedSession {
  repoPath: string;
  baseSha: string;
  headSha: string;
  prInput: string | null;
  index: number;
  view: ViewMode;
  selectedFile: string | null;
  savedAt: number;
}

interface ReplayState {
  // repository
  repo: RepoInfo | null;
  branches: BranchInfo[];
  tags: TagInfo[];
  headState: HeadState | null;
  // resolved replay
  range: ReplayRange | null;
  pr: PrReplay | null;
  hasWorkingTree: boolean;
  wtFrame: WorkingTreeFrame | null;
  index: number; // frame index: 0 = base, 1..N = commits, N+1 = working tree
  // playback
  playing: boolean;
  speed: number; // multiplier: 0.5 | 1 | 2
  adaptivePlayback: boolean;
  view: ViewMode;
  // selection & presentation
  selectedFile: string | null;
  diffMode: DiffMode;
  mergeParent: number;
  timelineZoom: number | "fit";
  timelineScroll: number;
  groupChapters: boolean;
  expandedDirs: string[];
  sidebarCollapsed: boolean;
  // session
  screen: Screen;
  busy: boolean;
  error: string | null;
  errorDetail: string | null;
  recentRepos: string[];
  theme: Theme;
  uiZoomLevel: number;
  repoChanged: boolean;
  session: SavedSession | null;

  openRepo(path: string): Promise<boolean>;
  configureRange(
    baseRef: string | null,
    headRef: string | null,
    useMergeBase: boolean,
    firstParent: boolean,
  ): Promise<boolean>;
  resolvePr(prInput: string, version: string | null): Promise<boolean>;
  finishResolve(range: ReplayRange, pr: PrReplay | null): void;
  createDemoRepo(): Promise<boolean>;
  loadWorkingTree(): Promise<void>;
  resumeSession(): Promise<boolean>;
  reset(): void;
  setIndex(i: number): void;
  step(delta: number): void;
  setPlaying(p: boolean): void;
  setView(v: ViewMode): void;
  setScreen(v: Screen): void;
  setSelectedFile(f: string | null): void;
  toggleDir(dirKey: string): void;
  setError(message: string | null, detail?: string | null): void;
  setMergeParent(p: number): void;
  setTimelineZoom(z: number | "fit"): void;
  setTimelineScroll(s: number): void;
  zoomTimelineIn(): void;
  zoomTimelineOut(): void;
  fitTimeline(): void;
  setTheme(t: Theme): void;
  zoomUiIn(): void;
  zoomUiOut(): void;
  resetUiZoom(): void;
  refreshRepo(): Promise<void>;
}

/** Frame count: base + commits + optional working-tree frame. */
export function frameCount(range: ReplayRange, hasWorkingTree: boolean): number {
  return range.commits.length + 1 + (hasWorkingTree ? 1 : 0);
}

/** SHA of the frame at `index`; the working-tree frame uses "WORKTREE". */
export function frameSha(range: ReplayRange, index: number, hasWorkingTree = false): string {
  if (index === 0) return range.baseSha;
  if (hasWorkingTree && index === range.commits.length + 1) return "WORKTREE";
  return range.commits[Math.min(index - 1, range.commits.length - 1)].sha;
}

/** The commit meta for a frame, or null for base / working tree. */
export function frameCommit(range: ReplayRange, index: number) {
  if (index === 0) return null;
  if (index > range.commits.length) return null;
  return range.commits[index - 1];
}

export const useReplay = create<ReplayState>()(
  persist(
    (set, get) => ({
      repo: null,
      branches: [],
      tags: [],
      headState: null,
      range: null,
      pr: null,
      hasWorkingTree: false,
      wtFrame: null,
      index: 0,
      playing: false,
      speed: 1,
      adaptivePlayback: false,
      view: "step",
      selectedFile: null,
      diffMode: "unified",
      mergeParent: 0,
      timelineZoom: "fit",
      timelineScroll: 0,
      groupChapters: false,
      expandedDirs: [],
      sidebarCollapsed: false,
      screen: "replay",
      busy: false,
      error: null,
      errorDetail: null,
      recentRepos: [],
      theme: "system",
      uiZoomLevel: 0,
      repoChanged: false,
      session: null,

      async openRepo(path) {
        set({ busy: true, error: null, errorDetail: null });
        try {
          const repo = await api.openRepository(path);
          const [branches, tags, headState] = await Promise.all([
            api.listBranches(repo.id),
            api.listTags(repo.id),
            api.getHeadState(repo.id),
          ]);
          const recentRepos = [path, ...get().recentRepos.filter((p) => p !== path)].slice(0, 8);
          set({
            repo,
            branches,
            tags,
            headState,
            recentRepos,
            range: null,
            pr: null,
            index: 0,
            selectedFile: null,
            playing: false,
            expandedDirs: [],
            wtFrame: null,
            hasWorkingTree: false,
            repoChanged: false,
            busy: false,
          });
          clearCaches();
          return true;
        } catch (e) {
          const err = e as { message?: string; detail?: string | null };
          set({ busy: false, error: err.message ?? String(e), errorDetail: err.detail ?? null });
          return false;
        }
      },

      async configureRange(baseRef, headRef, useMergeBase, firstParent) {
        const { repo } = get();
        if (!repo) return false;
        set({ busy: true, error: null, errorDetail: null, playing: false });
        try {
          const range = await api.resolveReplay(repo.id, { baseRef, headRef, useMergeBase, firstParent });
          get().finishResolve(range, null);
          return true;
        } catch (e) {
          const err = e as { message?: string; detail?: string | null };
          set({ busy: false, error: err.message ?? String(e), errorDetail: err.detail ?? null });
          return false;
        }
      },

      async resolvePr(prInput, version) {
        const { repo } = get();
        if (!repo) return false;
        set({ busy: true, error: null, errorDetail: null, playing: false });
        try {
          const pr = await api.resolvePrReplay(repo.id, prInput, version);
          get().finishResolve(pr.range, pr);
          return true;
        } catch (e) {
          const err = e as { message?: string; detail?: string | null };
          set({ busy: false, error: err.message ?? String(e), errorDetail: err.detail ?? null });
          return false;
        }
      },

      finishResolve(range, pr) {
        const { repo, headState } = get();
        const hasWorkingTree = !!repo && !!headState && range.headSha === headState.sha;
        set({
          range,
          pr,
          hasWorkingTree,
          wtFrame: null,
          index: 0,
          selectedFile: null,
          mergeParent: 0,
          expandedDirs: [],
          timelineScroll: 0,
          busy: false,
          repoChanged: false,
          session: repo
            ? {
                repoPath: repo.path,
                baseSha: range.baseSha,
                headSha: range.headSha,
                prInput: pr ? String(pr.number) : null,
                index: 0,
                view: "step",
                selectedFile: null,
                savedAt: Date.now(),
              }
            : null,
        });
      },

      async loadWorkingTree() {
        const { repo, wtFrame } = get();
        if (!repo || wtFrame) return;
        try {
          const frame = await api.getWorkingTree(repo.id);
          set({ wtFrame: frame });
        } catch (e) {
          const err = e as { message?: string };
          set({ error: err.message ?? String(e) });
        }
      },

      /** One-click onboarding: build the demo fixture and open it. */
      async createDemoRepo() {
        set({ busy: true, error: null, errorDetail: null });
        try {
          const path = await invoke<string | null>("ensure_demo_fixture");
          if (!path) throw new Error("the demo repository could not be created");
          const ok = await get().openRepo(path);
          if (!ok) return false;
          // The demo repo's whole story: root → HEAD.
          await get().configureRange("", null, false, false);
          return true;
        } catch (e) {
          const err = e as { message?: string };
          set({ busy: false, error: err.message ?? String(e) });
          return false;
        }
      },

      async resumeSession() {
        const { session } = get();
        if (!session) return false;
        const ok = await get().openRepo(session.repoPath);
        if (!ok) return false;
        const { repo } = get();
        if (!repo) return false;
        try {
          if (session.prInput) {
            const pr = await api.resolvePrReplay(repo.id, session.prInput, session.headSha);
            get().finishResolve(pr.range, pr);
          } else {
            const range = await api.resolveReplay(repo.id, {
              baseRef: session.baseSha,
              headRef: session.headSha,
              useMergeBase: false,
              firstParent: false,
            });
            get().finishResolve(range, null);
          }
          set({ index: session.index, view: session.view, selectedFile: session.selectedFile });
          return true;
        } catch (e) {
          const err = e as { message?: string };
          set({ error: err.message ?? String(e) });
          return false;
        }
      },

      reset() {
        set({
          repo: null,
          branches: [],
          tags: [],
          range: null,
          pr: null,
          index: 0,
          playing: false,
          selectedFile: null,
          expandedDirs: [],
          busy: false,
          error: null,
          errorDetail: null,
          mergeParent: 0,
          wtFrame: null,
          hasWorkingTree: false,
          headState: null,
        });
      },

      setIndex(i) {
        const { range, hasWorkingTree } = get();
        if (!range) return;
        const max = frameCount(range, hasWorkingTree) - 1;
        const clamped = Math.min(max, Math.max(0, i));
        const atEnd = clamped >= max;
        set({ index: clamped, mergeParent: 0, playing: get().playing && !atEnd });
        if (clamped === max && hasWorkingTree) void get().loadWorkingTree();
      },

      step(delta) {
        get().setIndex(get().index + delta);
      },

      setPlaying(p) {
        const { range, hasWorkingTree, index } = get();
        if (p && range && index >= frameCount(range, hasWorkingTree) - 1) {
          // Play from the start when pressed at the end.
          set({ index: 0, playing: true });
        } else {
          set({ playing: p });
        }
      },

      setView(v) {
        set({ view: v });
      },

      setScreen(v) {
        set({ screen: v, playing: false });
      },

      setSelectedFile(f) {
        set({ selectedFile: f });
      },

      toggleDir(dirKey) {
        const dirs = get().expandedDirs;
        set({
          expandedDirs: dirs.includes(dirKey) ? dirs.filter((d) => d !== dirKey) : [...dirs, dirKey],
        });
      },

      setError(message, detail = null) {
        set({ error: message, errorDetail: detail });
      },

      setMergeParent(p) {
        set({ mergeParent: p, selectedFile: null });
      },

      setTimelineZoom(z) {
        set({ timelineZoom: z });
      },

      setTimelineScroll(s) {
        set({ timelineScroll: s });
      },

      zoomTimelineIn() {
        set({ timelineZoom: nextZoomIn(get().timelineZoom) });
      },

      zoomTimelineOut() {
        const next = nextZoomOut(get().timelineZoom);
        if (next === "fit") set({ timelineZoom: "fit", timelineScroll: 0 });
        else set({ timelineZoom: next });
      },

      fitTimeline() {
        set({ timelineZoom: "fit", timelineScroll: 0 });
      },

      setTheme(t) {
        set({ theme: t });
        applyTheme(t);
      },

      zoomUiIn() {
        const next = clampUiZoom(get().uiZoomLevel + 1);
        set({ uiZoomLevel: next });
        applyUiZoom(next);
      },

      zoomUiOut() {
        const next = clampUiZoom(get().uiZoomLevel - 1);
        set({ uiZoomLevel: next });
        applyUiZoom(next);
      },

      resetUiZoom() {
        set({ uiZoomLevel: 0 });
        applyUiZoom(0);
      },

      async refreshRepo() {
        const { repo, range } = get();
        if (!repo) return;
        const info = await api.openRepository(repo.path); // revalidates + reuses handle
        const [branches, tags, headState] = await Promise.all([
          api.listBranches(info.id),
          api.listTags(info.id),
          api.getHeadState(info.id),
        ]);
        // The working-tree frame exists only while the replay head is the
        // checked-out commit — recompute after a repository change.
        const hasWorkingTree = !!range && range.headSha === headState.sha;
        set({ repo: info, branches, tags, headState, repoChanged: false, wtFrame: null, hasWorkingTree });
      },
    }),
    {
      name: "git-replay",
      partialize: (s) => ({
        recentRepos: s.recentRepos,
        theme: s.theme,
        uiZoomLevel: s.uiZoomLevel,
        diffMode: s.diffMode,
        speed: s.speed,
        adaptivePlayback: s.adaptivePlayback,
        view: s.view,
        groupChapters: s.groupChapters,
        sidebarCollapsed: s.sidebarCollapsed,
        session: s.session,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        applyTheme(state.theme);
        applyUiZoom(state.uiZoomLevel ?? 0);
        state.view = coerceView(state.view);
        if (state.session) state.session.view = coerceView(state.session.view);
      },
    },
  ),
);

/** Drop removed view ids (e.g. persisted `"map"`) so restore cannot land on a blank workspace. */
export function coerceView(v: unknown): ViewMode {
  return v === "snapshot" || v === "evolution" ? v : "step";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

/** Cursor/VS Code step: each level is ×1.2. 0 = 100%. */
const UI_ZOOM_FACTOR = 1.2;
const UI_ZOOM_MIN = -5;
const UI_ZOOM_MAX = 5;

function clampUiZoom(level: number): number {
  return Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, Math.round(level)));
}

export function uiZoomPercent(level: number): number {
  return Math.round(UI_ZOOM_FACTOR ** level * 100);
}

function applyUiZoom(level: number) {
  try {
    void getCurrentWebview()
      .setZoom(UI_ZOOM_FACTOR ** level)
      .catch(() => {
        // jsdom / `vite preview` has no webview.
      });
  } catch {
    // Not running inside Tauri.
  }
}
