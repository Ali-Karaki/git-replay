// Landing screen: open a repository (native folder dialog) or reopen a
// recent one. Everything stays local — nothing is ever uploaded.

import { open } from "@tauri-apps/plugin-dialog";
import { BranchIcon, ClockIcon, FolderIcon, GearIcon, HelpIcon, PlayIcon } from "../../components/Icons";
import { ErrorPanel } from "../../components/States";
import { displayPath } from "../../lib/format";
import { useReplay } from "../../stores/replay";

function repoName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function Welcome() {
  const openRepo = useReplay((s) => s.openRepo);
  const resumeSession = useReplay((s) => s.resumeSession);
  const recentRepos = useReplay((s) => s.recentRepos);
  const busy = useReplay((s) => s.busy);
  const error = useReplay((s) => s.error);
  const errorDetail = useReplay((s) => s.errorDetail);
  const session = useReplay((s) => s.session);
  const set = useReplay.setState;

  const pickAndOpen = async () => {
    try {
      const dir = await open({ directory: true, title: "Open a Git repository" });
      if (typeof dir === "string") {
        await openRepo(dir);
      }
    } catch (e) {
      // The native dialog or the open itself failing must never be silent.
      set({ error: (e as { message?: string }).message ?? String(e), errorDetail: null });
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-title">
          <div className="welcome-mark">
            <BranchIcon size={18} />
          </div>
          <div>
            <h1>Git Replay</h1>
            <p className="welcome-tagline">Replay how software evolved — commit by commit.</p>
          </div>
        </div>
        {error && (
          <ErrorPanel
            error={{ message: error, detail: errorDetail }}
            onRetry={() => set({ error: null, errorDetail: null })}
          />
        )}
        <div className="welcome-split">
          <div className="welcome-col">
            <h2>Start</h2>
            <button type="button" className="welcome-action" onClick={pickAndOpen} disabled={busy}>
              <FolderIcon size={16} /> {busy ? "Opening…" : "Open repository…"}
            </button>
            <button
              type="button"
              className="welcome-action"
              onClick={() => void useReplay.getState().createDemoRepo()}
              disabled={busy}
            >
              <PlayIcon size={16} /> Try the demo
              <span className="dim">14 commits, merge, renames</span>
            </button>
            {session && (
              <button type="button" className="welcome-action" onClick={() => void resumeSession()} disabled={busy}>
                <ClockIcon size={16} /> Resume last replay
                <span className="dim">{repoName(session.repoPath)}</span>
              </button>
            )}
            <div className="welcome-links">
              <button type="button" className="welcome-action" onClick={() => useReplay.setState({ screen: "about" })}>
                <HelpIcon size={16} /> About & how it works
              </button>
              <button
                type="button"
                className="welcome-action"
                onClick={() => useReplay.setState({ screen: "settings" })}
              >
                <GearIcon size={16} /> Settings
              </button>
              {import.meta.env.DEV && (
                <button
                  type="button"
                  className="welcome-action"
                  onClick={() => void import("../../lib/selfTest").then((m) => m.runSelfTest())}
                >
                  Run self-test (dev)
                </button>
              )}
            </div>
          </div>
          {recentRepos.length > 0 && (
            <div className="welcome-col">
              <h2>Recent</h2>
              {recentRepos.map((p) => (
                <button type="button" key={p} className="recent-row" onClick={() => void openRepo(p)} disabled={busy}>
                  <span className="recent-name">{repoName(p)}</span>
                  <span className="recent-path dim">{displayPath(p)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
