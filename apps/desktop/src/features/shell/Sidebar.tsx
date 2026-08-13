// Left navigation rail (Linear-style): the four replay views in plain
// language, plus Ask AI / Help / Settings in the footer. Collapses to an
// icon-only rail; the collapsed state persists (store `sidebarCollapsed`).

import { useReplay, type ViewMode } from "../../stores/replay";
import { useChat } from "../../stores/chat";
import { VIEWS } from "../../lib/views";
import {
  ChatIcon, ChevronLeftIcon, ChevronRight, DiffIcon, EvolutionIcon,
  FolderIcon, GearIcon, HelpIcon, MapIcon, type IconProps,
} from "../../components/Icons";

const VIEW_ICONS: Record<ViewMode, (p: IconProps) => React.ReactNode> = {
  step: DiffIcon,
  snapshot: FolderIcon,
  evolution: EvolutionIcon,
  map: MapIcon,
};

export function Sidebar({ onToggleCheatsheet }: { onToggleCheatsheet: () => void }) {
  const view = useReplay((s) => s.view);
  const hasRange = useReplay((s) => s.range !== null);
  const collapsed = useReplay((s) => s.sidebarCollapsed);
  const setView = useReplay((s) => s.setView);
  const setScreen = useReplay((s) => s.setScreen);
  const set = useReplay.setState;
  const chatOpen = useChat((s) => s.open);

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <button
        className="btn-icon sidebar-collapse"
        onClick={() => set({ sidebarCollapsed: !collapsed })}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeftIcon size={14} />}
      </button>
      <nav className="sidebar-nav">
        {VIEWS.map((v) => {
          const Icon = VIEW_ICONS[v.id];
          return (
            <button
              key={v.id}
              className={`sidebar-item ${view === v.id && hasRange ? "active" : ""}`}
              onClick={() => setView(v.id)}
              // No replay is open until a range resolves — the views have
              // nothing to show yet, so keep the nav inert instead of
              // silently doing nothing.
              disabled={!hasRange}
              aria-current={view === v.id && hasRange ? "page" : undefined}
              title={collapsed ? `${v.label} (${v.key})` : !hasRange ? "Pick a replay first" : undefined}
            >
              <span className="sidebar-icon"><Icon size={15} /></span>
              <span className="sidebar-label">{v.label}</span>
              <span className="sidebar-kbd">{v.key}</span>
              <span className="sidebar-sub">{v.sub}</span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <button
          className={`sidebar-item chat-trigger ${chatOpen ? "active" : ""}`}
          onClick={() => useChat.getState().setOpen(!chatOpen)}
          title={collapsed ? "Ask AI" : undefined}
          aria-label={collapsed ? "Ask AI" : undefined}
        >
          <span className="sidebar-icon"><ChatIcon size={15} /></span>
          <span className="sidebar-label">Ask AI</span>
        </button>
        <button
          className="sidebar-item"
          onClick={onToggleCheatsheet}
          title={collapsed ? "Help (?)" : undefined}
          aria-label={collapsed ? "Help" : undefined}
        >
          <span className="sidebar-icon"><HelpIcon size={15} /></span>
          <span className="sidebar-label">Help</span>
        </button>
        <button
          className="sidebar-item"
          // setScreen (not a raw set) so playback stops while Settings is up.
          onClick={() => setScreen("settings")}
          title={collapsed ? "Settings" : undefined}
          aria-label={collapsed ? "Settings" : undefined}
        >
          <span className="sidebar-icon"><GearIcon size={15} /></span>
          <span className="sidebar-label">Settings</span>
        </button>
      </div>
    </aside>
  );
}
