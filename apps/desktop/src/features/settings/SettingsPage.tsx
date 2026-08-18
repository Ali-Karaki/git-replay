// Settings: appearance, playback/display defaults, cache management, data
// reset, and the keyboard reference.

import { useEffect, useState } from "react";
import { CloseIcon, RefreshIcon, ZoomInIcon, ZoomOutIcon } from "../../components/Icons";
import { formatBytes } from "../../lib/format";
import { api } from "../../lib/ipc";
import { SHORTCUTS } from "../../lib/shortcuts";
import type { CacheInfo } from "../../lib/types";
import { type Theme, uiZoomPercent, useReplay } from "../../stores/replay";

const NAV = ["Appearance", "Playback", "Diff view", "Timeline", "Cache", "Data", "Keyboard", "About"] as const;

function sectionId(title: string): string {
  return `settings-${title.toLowerCase().replace(/\s+/g, "-")}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section" id={sectionId(title)}>
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

function Toggle({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`toggle${on ? " on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
    />
  );
}

export function SettingsPage() {
  const s = useReplay();
  const set = useReplay.setState;
  const [cache, setCache] = useState<CacheInfo | null>(null);
  const [clearing, setClearing] = useState(false);
  const [cacheNote, setCacheNote] = useState<string | null>(null);

  const loadCache = () => {
    api
      .getCacheInfo()
      .then(setCache)
      .catch(() => setCache(null));
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
        <button
          type="button"
          className="btn-icon"
          aria-label="Close"
          title="Close"
          onClick={() => s.setScreen("replay")}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav">
          {NAV.map((title) => (
            <button
              type="button"
              key={title}
              className="settings-nav-item"
              onClick={() => document.getElementById(sectionId(title))?.scrollIntoView()}
            >
              {title}
            </button>
          ))}
        </nav>
        <div className="page-body">
          <Section title="Appearance">
            <Row label="Theme" hint="Color theme for the window">
              <select className="select" value={s.theme} onChange={(e) => s.setTheme(e.target.value as Theme)}>
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </Row>
            <Row label="Zoom" hint="Ctrl++ / Ctrl+- / Ctrl+0 — scales the whole window">
              <div className="segmented">
                <button type="button" className="btn-icon" onClick={() => s.zoomUiOut()} aria-label="Zoom out">
                  <ZoomOutIcon size={13} />
                </button>
                <button type="button" className="chip" onClick={() => s.resetUiZoom()} title="Reset zoom">
                  {uiZoomPercent(s.uiZoomLevel)}%
                </button>
                <button type="button" className="btn-icon" onClick={() => s.zoomUiIn()} aria-label="Zoom in">
                  <ZoomInIcon size={13} />
                </button>
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
            <Row
              label="Adaptive playback"
              hint="Small commits flash by, substantial ones pause (stats from the prefetch cache)"
            >
              <Toggle
                on={s.adaptivePlayback}
                label="Adaptive playback"
                onToggle={() => set({ adaptivePlayback: !s.adaptivePlayback })}
              />
            </Row>
          </Section>

          <Section title="Diff view">
            <Row label="Default layout">
              <select
                className="select"
                value={s.diffMode}
                onChange={(e) => set({ diffMode: e.target.value as "unified" | "split" })}
              >
                <option value="unified">Unified</option>
                <option value="split">Split</option>
              </select>
            </Row>
          </Section>

          <Section title="Timeline">
            <Row label="Group commits into chapters" hint="An alternate presentation — raw commits always stay visible">
              <Toggle
                on={s.groupChapters}
                label="Group commits into chapters"
                onToggle={() => set({ groupChapters: !s.groupChapters })}
              />
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
              <button type="button" className="btn" onClick={() => void clearCache()} disabled={clearing}>
                <RefreshIcon size={13} /> {clearing ? "Clearing…" : "Clear cache"}
              </button>
            </Row>
            {cacheNote && <div className="settings-note">{cacheNote}</div>}
          </Section>

          <Section title="Data">
            <Row label="Reset app data" hint="Clears preferences, recent repositories, and the saved session">
              <button type="button" className="btn" onClick={resetData}>
                Reset
              </button>
            </Row>
          </Section>

          <Section title="Keyboard">
            <div className="kbd-table">
              {SHORTCUTS.map(([key, action]) => (
                <div key={key} className="kbd-row">
                  <span className="kbd-keys">{key}</span>
                  <span className="dim">{action}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="About">
            <Row label="How Git Replay works" hint="Product story, architecture, and principles">
              <button type="button" className="btn" onClick={() => s.setScreen("about")}>
                Open About
              </button>
            </Row>
          </Section>
        </div>
      </div>
    </div>
  );
}
