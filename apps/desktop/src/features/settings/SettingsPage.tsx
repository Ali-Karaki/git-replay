// Settings: appearance, playback/display defaults, cache management, data
// reset, and the keyboard reference.

import { useEffect, useState } from "react";
import { api } from "../../lib/ipc";
import { useReplay, type Theme } from "../../stores/replay";
import type { CacheInfo } from "../../lib/types";
import { formatBytes } from "../../lib/format";
import { RefreshIcon } from "../../components/Icons";

const KEYBOARD: Array<[string, string]> = [
  ["← / →", "previous / next commit"],
  ["Shift+← / Shift+→", "jump 5 commits"],
  ["Space", "play / pause"],
  ["Home / End", "base / HEAD"],
  ["1 / 2 / 3 / 4", "Step / Snapshot / File Evolution / Change Map"],
  ["/", "search commits, files, and changed content"],
  ["Ctrl+K", "command palette"],
  ["Esc", "close dialogs"],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <span>{label}</span>
        {hint && <span className="dim settings-row-hint">{hint}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const s = useReplay();
  const set = useReplay.setState;
  const [cache, setCache] = useState<CacheInfo | null>(null);
  const [clearing, setClearing] = useState(false);
  const [cacheNote, setCacheNote] = useState<string | null>(null);

  const loadCache = () => {
    api.getCacheInfo().then(setCache).catch(() => setCache(null));
  };
  useEffect(loadCache, []);

  const clearCache = async () => {
    setClearing(true);
    setCacheNote(null);
    try {
      const info = await api.clearCache();
      setCache(info);
      setCacheNote("Cache cleared — it will rebuild from Git as you browse.");
    } catch (e) {
      setCacheNote(`Could not clear the cache: ${(e as { message?: string }).message ?? String(e)}`);
    } finally {
      setClearing(false);
    }
  };

  const resetData = () => {
    void useReplay.persist.clearStorage();
    window.setTimeout(() => window.location.reload(), 50);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Settings</h1>
        <button className="btn" onClick={() => s.setScreen("replay")}>Back</button>
      </div>
      <div className="page-body">
        <Section title="Appearance">
          <Row label="Theme">
            <div className="segmented">
              {(["system", "light", "dark"] as Theme[]).map((t) => (
                <button key={t} className={`chip big ${s.theme === t ? "on" : ""}`} onClick={() => s.setTheme(t)}>
                  {t}
                </button>
              ))}
            </div>
          </Row>
        </Section>

        <Section title="Playback">
          <Row label="Default speed" hint="You can always change this in the transport bar">
            <select className="select" value={s.speed} onChange={(e) => set({ speed: Number(e.target.value) })}>
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
            </select>
          </Row>
          <Row label="Adaptive playback" hint="Small commits flash by, substantial ones pause (stats from the prefetch cache)">
            <button className={`chip ${s.adaptivePlayback ? "on" : ""}`} onClick={() => set({ adaptivePlayback: !s.adaptivePlayback })}>
              {s.adaptivePlayback ? "enabled" : "disabled"}
            </button>
          </Row>
        </Section>

        <Section title="Diff view">
          <Row label="Default layout">
            <div className="segmented">
              <button className={`chip big ${s.diffMode === "unified" ? "on" : ""}`} onClick={() => set({ diffMode: "unified" })}>unified</button>
              <button className={`chip big ${s.diffMode === "split" ? "on" : ""}`} onClick={() => set({ diffMode: "split" })}>split</button>
            </div>
          </Row>
          <Row label="Hide generated files by default" hint="Lockfiles, build output, minified files — always toggleable in the Step view">
            <button className={`chip ${s.hideGenerated ? "on" : ""}`} onClick={() => set({ hideGenerated: !s.hideGenerated })}>
              {s.hideGenerated ? "hidden" : "shown"}
            </button>
          </Row>
          <Row label="Hide whitespace-only changes by default">
            <button className={`chip ${s.hideWhitespaceOnly ? "on" : ""}`} onClick={() => set({ hideWhitespaceOnly: !s.hideWhitespaceOnly })}>
              {s.hideWhitespaceOnly ? "hidden" : "shown"}
            </button>
          </Row>
        </Section>

        <Section title="Timeline">
          <Row label="Group commits into chapters" hint="An alternate presentation — raw commits always stay visible">
            <button className={`chip ${s.groupChapters ? "on" : ""}`} onClick={() => set({ groupChapters: !s.groupChapters })}>
              {s.groupChapters ? "enabled" : "disabled"}
            </button>
          </Row>
        </Section>

        <Section title="Cache">
          <Row label="Derived cache" hint={cache?.path || "…"}>
            <span className="settings-cache-size">
              {cache ? formatBytes(cache.sizeBytes) : "…"}
              {cache && cache.sizeBytes > 0 && (
                <span className="dim"> — derived data only; Git stays the source of truth</span>
              )}
            </span>
          </Row>
          <Row label="Clear cache" hint="Deletes the database; the app rebuilds everything from Git as you browse">
            <button className="btn" onClick={() => void clearCache()} disabled={clearing}>
              <RefreshIcon size={13} /> {clearing ? "Clearing…" : "Clear cache"}
            </button>
          </Row>
          {cacheNote && <div className="settings-note">{cacheNote}</div>}
        </Section>

        <Section title="Data">
          <Row label="Reset app data" hint="Clears preferences, recent repositories, and the saved session">
            <button className="btn" onClick={resetData}>Reset</button>
          </Row>
        </Section>

        <Section title="Keyboard">
          <div className="kbd-table">
            {KEYBOARD.map(([key, action]) => (
              <div key={key} className="kbd-row">
                <span className="kbd-keys">{key}</span>
                <span className="dim">{action}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="About">
          <Row label="How Git Replay works" hint="Product story, architecture, and principles">
            <button className="btn" onClick={() => s.setScreen("about")}>Open About</button>
          </Row>
        </Section>
      </div>
    </div>
  );
}
