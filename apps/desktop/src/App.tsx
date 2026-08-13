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
import { focusSearch } from "./features/search/SearchBar";

function ReplayWorkspace() {
  const view = useReplay((s) => s.view);
  const leftCollapsed = useReplay((s) => s.leftCollapsed);
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
      {repo && <TopBar onOpenPalette={() => setPaletteOpen(true)} />}
      {!repo && <Welcome />}
      {repo && !range && <RangeSetup />}
      {repo && range && <ReplayWorkspace />}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export default App;
