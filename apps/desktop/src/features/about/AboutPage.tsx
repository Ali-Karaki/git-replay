// About / How it works: the product story, the architecture in plain words,
// and the principles the app is built on.

import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useReplay } from "../../stores/replay";
import { BranchIcon } from "../../components/Icons";

const PRINCIPLES: Array<[string, string]> = [
  ["Git is the source of truth", "Everything you see is computed from the repository with git's own plumbing commands. Nothing is reimplemented, nothing is invented."],
  ["Offline by default", "Opening and replaying a repository never uploads anything. The only network use is what you explicitly trigger — fetching a pull request."],
  ["The cache is disposable", "The SQLite database is derived data. Deleting it loses acceleration, never information — the app rebuilds it from Git."],
  ["Raw history is never hidden", "Filters, chapters, and aggregation are alternate presentations. The actual commits are always one toggle away."],
  ["Navigation feels instant", "Nearby frames are prefetched and content-addressed caches make stepping back and forth effectively free."],
];

const STEPS: Array<[string, string]> = [
  ["Pick a history", "A branch (starting at its merge base), a commit range, tags, a pull request, or the whole repository. That range becomes the replay."],
  ["Step through frames", "Each commit is a frame: what changed (Step view) and what the project looked like after it (Snapshot view). Merge commits compare against the parent you choose."],
  ["Follow what matters", "Pick any file and watch only its story — creations, modifications, renames — with File Evolution, or see all activity at once on the Change Map."],
  ["Replay uncommitted work", "When the replay ends at your checkout, a Working Tree frame shows staged and unstaged changes, including untracked files."],
];

export function AboutPage() {
  const s = useReplay();
  const [version, setVersion] = useState("0.1.0");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => undefined);
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <h1>About Git Replay</h1>
        <button className="btn" onClick={() => s.setScreen("replay")}>Back</button>
      </div>
      <div className="page-body">
        <div className="about-hero">
          <div className="welcome-mark"><BranchIcon size={26} /></div>
          <div>
            <h2>Replay how software evolved.</h2>
            <p className="dim">
              Git Replay is a local-first desktop app that turns a repository's history into a
              timeline you can play. It is a development timelapse player, not a Git client:
              the product answers <em>how did this codebase get from state A to state B?</em>
            </p>
            <p className="about-version dim">Version {version} · MIT licensed · open source</p>
          </div>
        </div>

        <section className="about-section">
          <h3>How it works</h3>
          <div className="about-steps">
            {STEPS.map(([title, body]) => (
              <div key={title} className="about-step">
                <h4>{title}</h4>
                <p className="dim">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="about-section">
          <h3>Under the hood</h3>
          <p className="dim">
            A Rust engine speaks to your system Git with plumbing commands in machine-readable
            form, builds a typed replay model, and hands it to a React UI over Tauri IPC.
            Presentation-heavy work — syntax highlighting, word-level diffs — runs in Web
            Workers, and an SQLite cache keyed by content address makes repeat visits instant.
            The timeline renders on a canvas, so even hundred-thousand-commit histories stay
            smooth. The full design record lives in <code>docs/architecture.md</code> and
            <code> docs/decisions/</code> in the repository.
          </p>
        </section>

        <section className="about-section">
          <h3>Principles</h3>
          <div className="about-principles">
            {PRINCIPLES.map(([title, body]) => (
              <div key={title} className="about-principle">
                <h4>{title}</h4>
                <p className="dim">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="about-section">
          <h3>Contributing</h3>
          <p className="dim">
            Git Replay is open source (MIT). The repository includes a contributing guide, a
            code of conduct, a security policy, and a test suite that pins the engine against
            real git output — issues and pull requests are welcome.
          </p>
        </section>
      </div>
    </div>
  );
}
