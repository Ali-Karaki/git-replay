// Left navigation rail (Linear-style): the four replay views in plain
// language, plus Ask AI / Help / Settings in the footer. Collapses to an
// icon-only rail; the collapsed state persists (store `sidebarCollapsed`).

import { useReplay, type ViewMode } from "../../stores/replay";
import { useChat } from "../../stores/chat";
import {
  ChatIcon, ChevronLeftIcon, ChevronRight, DiffIcon, EvolutionIcon,
  FolderIcon, GearIcon, HelpIcon, MapIcon, type IconProps,
} from "../../components/Icons";

interface NavItem {
  id: ViewMode;
  icon: (p: IconProps) => React.ReactNode;
  label: string;
  key: string;
  sub: string;
}

const NAV: NavItem[] = [
  { id: "step", icon: DiffIcon, label: "What changed", key: "1", sub: "Commits, files, diffs" },
  { id: "snapshot", icon: FolderIcon, label: "Browse code", key: "2", sub: "Files at any point" },
  { id: "evolution", icon: EvolutionIcon, label: "File story", key: "3", sub: "Follow one file" },
  { id: "map", icon: MapIcon, label: "Overview", key: "4", sub: "Whole-range heatmap" },
];

export function Sidebar({ onToggleCheatsheet }: { onToggleCheatsheet: () => void }) {
  const view = useReplay((s) => s.view);
  const hasRange = useReplay((s) => s.range !== null);
  const collapsed = useReplay((s) => s.sidebarCollapsed);
  const setView = useReplay((s) => s.setView);
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
        {NAV.map((v) => (
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
            <span className="sidebar-icon"><v.icon size={15} /></span>
            <span className="sidebar-label">{v.label}</span>
            <span className="sidebar-kbd">{v.key}</span>
            <span className="sidebar-sub">{v.sub}</span>
          </button>
        ))}
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
          onClick={() => set({ screen: "settings" })}
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
