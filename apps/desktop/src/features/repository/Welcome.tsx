// Landing screen: open a repository (native folder dialog) or reopen a
// recent one. Everything stays local — nothing is ever uploaded.

import { open } from "@tauri-apps/plugin-dialog";
import { useReplay } from "../../stores/replay";
import { BranchIcon, ClockIcon, FolderIcon } from "../../components/Icons";
import { ErrorPanel } from "../../components/States";

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
      <div className="welcome-card">
        <div className="welcome-mark"><BranchIcon size={26} /></div>
        <h1>Git Replay</h1>
        <p className="welcome-tagline">Replay how software evolved — commit by commit.</p>
        <p className="welcome-hint dim">
          Open any Git repository, pick a range, and press Play. Nothing ever leaves your machine.
        </p>
        <div className="welcome-steps">
          <div className="welcome-step"><b>1</b><span>Open any repository</span></div>
          <div className="welcome-step"><b>2</b><span>Pick what to watch</span></div>
          <div className="welcome-step"><b>3</b><span>Press Play</span></div>
        </div>
        <button className="btn btn-primary btn-large" onClick={pickAndOpen} disabled={busy}>
          <FolderIcon size={15} /> {busy ? "Opening…" : "Open repository"}
        </button>
        <button className="btn" onClick={() => void useReplay.getState().createDemoRepo()} disabled={busy}>
          Try the demo <span className="dim">— a 14-commit repository with a merge, renames, and binaries</span>
        </button>
        {session && (
          <button className="btn" onClick={() => void resumeSession()} disabled={busy}>
            Resume last replay <span className="dim">({session.repoPath.split(/[\\/]/).pop()})</span>
          </button>
        )}
        <div className="welcome-links">
          <button className="btn-ghost" onClick={() => useReplay.setState({ screen: "about" })}>
            About & how it works
          </button>
          <button className="btn-ghost" onClick={() => useReplay.setState({ screen: "settings" })}>
            Settings
          </button>
          {import.meta.env.DEV && (
            <button className="btn-ghost" onClick={() => void import("../../lib/selfTest").then((m) => m.runSelfTest())}>
              Run self-test (dev)
            </button>
          )}
        </div>
        {error && (
          <ErrorPanel
            error={{ message: error, detail: errorDetail }}
            onRetry={() => set({ error: null, errorDetail: null })}
          />
        )}
        {recentRepos.length > 0 && (
          <div className="recent">
            <div className="recent-title dim"><ClockIcon size={12} /> Recent</div>
            {recentRepos.map((p) => (
              <button key={p} className="recent-row" onClick={() => void openRepo(p)} disabled={busy}>
                <span className="recent-path">{p}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
