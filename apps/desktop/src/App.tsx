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
import { Sidebar } from "./features/shell/Sidebar";
import { StepView } from "./features/step/StepView";
import { SnapshotView } from "./features/snapshot/SnapshotView";
import { FileEvolution } from "./features/evolution/FileEvolution";
import { ChangeMap } from "./features/map/ChangeMap";
import { Timeline } from "./features/timeline/Timeline";
import { Transport } from "./features/transport/Transport";
import { CommandPalette } from "./features/palette/CommandPalette";
import { SettingsPage } from "./features/settings/SettingsPage";
import { AboutPage } from "./features/about/AboutPage";
import { Cheatsheet } from "./features/shell/Cheatsheet";
import { ChatPanel } from "./features/chat/ChatPanel";
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

  if (range && range.commits.length === 0) {
    return <EmptyReplay />;
  }

  return (
    <div className="workspace">
      <div className="body">
        {view === "step" && <StepView />}
        {view === "snapshot" && <SnapshotView />}
        {view === "evolution" && <FileEvolution />}
        {view === "map" && <ChangeMap />}
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
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);

  usePlayback();
  usePrefetch();
  useRepoWatch();
  useKeyboard({
    paletteOpen,
    onOpenPalette: () => setPaletteOpen(true),
    onClosePalette: () => setPaletteOpen(false),
    onFocusSearch: focusSearch,
    onToggleCheatsheet: () => setCheatsheetOpen((o) => !o),
  });

  const showShell = repo !== null && screen !== "settings" && screen !== "about";

  return (
    <div className="app">
      {showShell && <TopBar onOpenPalette={() => setPaletteOpen(true)} />}
      <div className="app-main">
        {showShell && <Sidebar onToggleCheatsheet={() => setCheatsheetOpen((o) => !o)} />}
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
        <ChatPanel />
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onShowCheatsheet={() => setCheatsheetOpen(true)}
      />
      <Cheatsheet open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />
    </div>
  );
}

export default App;
