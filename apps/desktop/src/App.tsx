// App shell: welcome → range setup → replay workspace.

import { useState } from "react";
import { useReplay } from "./stores/replay";
import { useKeyboard } from "./hooks/useKeyboard";
import { usePlayback } from "./hooks/usePlayback";
import { usePrefetch } from "./hooks/usePrefetch";
import { useRepoWatch } from "./hooks/useRepoWatch";
import { Welcome } from "./features/repository/Welcome";
import { RangeSetup } from "./features/repository/RangeSetup";
import { TopBar } from "./features/shell/TopBar";
import { StepView } from "./features/step/StepView";
import { SnapshotView } from "./features/snapshot/SnapshotView";
import { FileEvolution } from "./features/evolution/FileEvolution";
import { ChangeMap } from "./features/map/ChangeMap";
import { Timeline } from "./features/timeline/Timeline";
import { Transport } from "./features/transport/Transport";
import { CommandPalette } from "./features/palette/CommandPalette";
import { SettingsPage } from "./features/settings/SettingsPage";
import { AboutPage } from "./features/about/AboutPage";
import { focusSearch } from "./features/search/SearchBar";

/** An empty range is valid git semantics (base == head), but silently showing
 *  a one-frame workspace reads as "nothing happened" — explain it instead. */
function EmptyReplay() {
  const set = useReplay.setState;
  return (
    <div className="empty-state">
      <div className="empty-title">This replay has no commits</div>
      <div className="empty-hint">
        The base and head you selected point at the same commit, so there is nothing between them to replay.
      </div>
      <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => set({ range: null })}>
        Choose a different range
      </button>
    </div>
  );
}

function ReplayWorkspace() {
  const view = useReplay((s) => s.view);
  const range = useReplay((s) => s.range);
  const leftCollapsed = useReplay((s) => s.leftCollapsed);

  if (range && range.commits.length === 0) {
    return <EmptyReplay />;
  }

  return (
    <div className="workspace">
      <div className="body">
        {!leftCollapsed && (
          <>
            {view === "step" && <StepView />}
            {view === "snapshot" && <SnapshotView />}
            {view === "evolution" && <FileEvolution />}
            {view === "map" && <ChangeMap />}
          </>
        )}
        {leftCollapsed && (
          <div className="main-panel collapsed">
            {view === "step" && <StepView />}
            {view === "snapshot" && <SnapshotView />}
            {view === "evolution" && <FileEvolution />}
            {view === "map" && <ChangeMap />}
          </div>
        )}
      </div>
      <div className="bottombar">
        <Timeline />
        <Transport />
      </div>
    </div>
  );
}

function App() {
  const repo = useReplay((s) => s.repo);
  const range = useReplay((s) => s.range);
  const screen = useReplay((s) => s.screen);
  const [paletteOpen, setPaletteOpen] = useState(false);

  usePlayback();
  usePrefetch();
  useRepoWatch();
  useKeyboard({
    paletteOpen,
    onOpenPalette: () => setPaletteOpen(true),
    onClosePalette: () => setPaletteOpen(false),
    onFocusSearch: focusSearch,
  });

  return (
    <div className="app">
      {repo && screen !== "settings" && screen !== "about" && <TopBar onOpenPalette={() => setPaletteOpen(true)} />}
      {screen === "settings" ? (
        <SettingsPage />
      ) : screen === "about" ? (
        <AboutPage />
      ) : !repo ? (
        <Welcome />
      ) : !range ? (
        <RangeSetup />
      ) : (
        <ReplayWorkspace />
      )}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export default App;
