// UI / playback state (Zustand). Repository data lives in the Rust engine and
// the module-level query caches — never in global React state (spec §32).

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "../lib/ipc";
import type {
  BranchInfo, ReplayRange, RepoInfo, TagInfo,
} from "../lib/types";

export type ViewMode = "step" | "snapshot" | "evolution";
export type Theme = "system" | "light" | "dark";
export type DiffMode = "unified" | "split";

interface ReplayState {
  // repository
  repo: RepoInfo | null;
  branches: BranchInfo[];
  tags: TagInfo[];
  // resolved replay
  range: ReplayRange | null;
  index: number; // frame index: 0 = base snapshot, 1..N = commits
  // playback
  playing: boolean;
  speed: number; // multiplier: 0.5 | 1 | 2
  view: ViewMode;
  // selection & presentation
  selectedFile: string | null;
  diffMode: DiffMode;
  hideGenerated: boolean;
  hideWhitespaceOnly: boolean;
  mergeParent: number;
  timelineZoom: number | "fit";
  expandedDirs: string[];
  // session
  busy: boolean;
  error: string | null;
  errorDetail: string | null;
  recentRepos: string[];
  theme: Theme;

  openRepo(path: string): Promise<boolean>;
  configureRange(baseRef: string | null, headRef: string | null, useMergeBase: boolean, firstParent: boolean): Promise<boolean>;
  reset(): void;
  setIndex(i: number): void;
  step(delta: number): void;
  setPlaying(p: boolean): void;
  setView(v: ViewMode): void;
  setSelectedFile(f: string | null): void;
  toggleDir(dirKey: string): void;
  setError(message: string | null, detail?: string | null): void;
  setMergeParent(p: number): void;
  setTimelineZoom(z: number | "fit"): void;
  setTheme(t: Theme): void;
}

/** SHA of the frame at `index` (0 = base snapshot). */
export function frameSha(range: ReplayRange, index: number): string {
  return index === 0 ? range.baseSha : range.commits[index - 1].sha;
}

/** The commit meta for a frame, or null for the base snapshot. */
export function frameCommit(range: ReplayRange, index: number) {
  return index === 0 ? null : range.commits[index - 1];
}

export const useReplay = create<ReplayState>()(
  persist(
    (set, get) => ({
      repo: null,
      branches: [],
      tags: [],
      range: null,
      index: 0,
      playing: false,
      speed: 1,
      view: "step",
      selectedFile: null,
      diffMode: "unified",
      hideGenerated: false,
      hideWhitespaceOnly: false,
      mergeParent: 0,
      timelineZoom: "fit",
      expandedDirs: [],
      busy: false,
      error: null,
      errorDetail: null,
      recentRepos: [],
      theme: "system",

      async openRepo(path) {
        set({ busy: true, error: null, errorDetail: null });
        try {
          const repo = await api.openRepository(path);
          const [branches, tags] = await Promise.all([api.listBranches(repo.id), api.listTags(repo.id)]);
          const recentRepos = [path, ...get().recentRepos.filter((p) => p !== path)].slice(0, 8);
          set({
            repo, branches, tags, recentRepos,
            range: null, index: 0, selectedFile: null, playing: false, expandedDirs: [],
            busy: false,
          });
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
          set({ range, index: 0, selectedFile: null, mergeParent: 0, expandedDirs: [], busy: false });
          return true;
        } catch (e) {
          const err = e as { message?: string; detail?: string | null };
          set({ busy: false, error: err.message ?? String(e), errorDetail: err.detail ?? null });
          return false;
        }
      },

      reset() {
        set({
          repo: null, branches: [], tags: [], range: null, index: 0,
          playing: false, selectedFile: null, expandedDirs: [], busy: false,
          error: null, errorDetail: null, mergeParent: 0,
        });
      },

      setIndex(i) {
        const { range } = get();
        if (!range) return;
        const max = range.commits.length;
        const clamped = Math.min(max, Math.max(0, i));
        const atEnd = clamped >= max;
        set({ index: clamped, mergeParent: 0, playing: get().playing && !atEnd });
      },

      step(delta) {
        get().setIndex(get().index + delta);
      },

      setPlaying(p) {
        const { range, index } = get();
        if (p && range && index >= range.commits.length) {
          // Play from the start when pressed at the end.
          set({ index: 0, playing: true });
        } else {
          set({ playing: p });
        }
      },

      setView(v) {
        set({ view: v });
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

      setTheme(t) {
        set({ theme: t });
        applyTheme(t);
      },
    }),
    {
      name: "git-replay",
      partialize: (s) => ({
        recentRepos: s.recentRepos,
        theme: s.theme,
        diffMode: s.diffMode,
        hideGenerated: s.hideGenerated,
        hideWhitespaceOnly: s.hideWhitespaceOnly,
        speed: s.speed,
        view: s.view,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    },
  ),
);

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}
