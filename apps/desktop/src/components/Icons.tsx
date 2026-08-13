// Minimal inline icon set (stroke-based, 16px grid). No icon library dep.

export interface IconProps {
  size?: number;
}

function Svg({
  size = 16,
  children,
  viewBox = "0 0 16 16",
}: IconProps & { children: React.ReactNode; viewBox?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 3.5v9l8-4.5-8-4.5z" fill="currentColor" stroke="none" />
  </Svg>
);
export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3.5v9M11 3.5v9" />
  </Svg>
);
export const PrevIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.5 3.5v9l-5-4.5 5-4.5z" fill="currentColor" stroke="none" />
    <path d="M5.5 3.5v9" />
  </Svg>
);
export const NextIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 3.5v9l5-4.5-5-4.5z" fill="currentColor" stroke="none" />
    <path d="M10.5 3.5v9" />
  </Svg>
);
export const FirstIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 3.5v9l-5-4.5 5-4.5z" fill="currentColor" stroke="none" />
    <path d="M11.5 3.5v9" />
  </Svg>
);
export const LastIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 3.5v9l5-4.5-5-4.5z" fill="currentColor" stroke="none" />
    <path d="M4.5 3.5v9" />
  </Svg>
);
export const ChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4l4 4-4 4" />
  </Svg>
);
export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 4L6 8l4 4" />
  </Svg>
);
export const HelpIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.3 6.2a1.8 1.8 0 1 1 2.6 1.7c-.8.4-.9 1-.9 1.6" />
    <path d="M8 12v.2" />
  </Svg>
);
export const DiffIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="2.5" width="12" height="4.5" rx="1" />
    <rect x="2" y="9" width="12" height="4.5" rx="1" />
    <path d="M5.5 4.75h5M8 2.5v4.5M5.5 11.25h5" />
  </Svg>
);
export const MapIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="2" width="5.5" height="5.5" rx="1" />
    <rect x="8.5" y="2" width="5.5" height="5.5" rx="1" />
    <rect x="2" y="8.5" width="5.5" height="5.5" rx="1" />
    <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" />
  </Svg>
);
export const SpeedIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 10.5a5 5 0 0 1 9 0" />
    <path d="M8 10.5l2.5-4" />
    <circle cx="8" cy="10.5" r="0.5" fill="currentColor" stroke="none" />
  </Svg>
);
export const PrIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="3.5" r="1.5" />
    <circle cx="5" cy="12.5" r="1.5" />
    <path d="M5 5v6" />
    <path d="M5 5c3 0 6 .5 8 2" />
    <path d="M11 5.5l3 1.5-3 1.5" />
  </Svg>
);
export const ChatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 12.5c3.5-4 5-4 8-6 1.8-1.2 3.4-1.6 4-1.5-.4 3.3-2.7 7.5-6 8-2.6.4-4.3-1.8-6-.5z" />
    <path d="M6 12.5c-.2-1.2.1-2.4 1-3.3" />
  </Svg>
);
export const GearIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1" />
  </Svg>
);
export const ChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6l4 4 4-4" />
  </Svg>
);
export const FolderIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 2h4.5A1.5 1.5 0 0 1 14 6.5v5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7z" />
  </Svg>
);
export const FileIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 2h5l3 3v9H4V2z" />
    <path d="M9 2v3h3" />
  </Svg>
);
export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </Svg>
);
export const BranchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="4.5" cy="4" r="1.5" />
    <circle cx="4.5" cy="12" r="1.5" />
    <circle cx="11.5" cy="6" r="1.5" />
    <path d="M4.5 5.5v5M4.5 6.5c3 0 4-2 7-2M4.5 12c3 0 4-3 5.5-3.75" />
  </Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);
export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.5 1.5" />
  </Svg>
);
export const TagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 8V2h6l6 6-6 6-6-6z" />
    <circle cx="5.5" cy="5.5" r="0.5" fill="currentColor" />
  </Svg>
);
export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
    <path d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" />
  </Svg>
);
export const FilterIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 3.5h12L9.5 8.5v4l-3 1.5v-5.5L2 3.5z" />
  </Svg>
);
export const FolderOpenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 6V4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 2H13a1 1 0 0 1 1 1v6.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5V6z" />
    <path d="M2 7.5h12" />
  </Svg>
);
export const EvolutionIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12.5l3.5-4 2.5 2L12.5 5" />
    <circle cx="3" cy="12.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="5" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
);
export const ImageIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <circle cx="5.5" cy="6" r="1" />
    <path d="M3 12l4-4 3 3 2.5-2.5L14 10" />
  </Svg>
);
export const WarningIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.5L14.5 13h-13L8 2.5z" />
    <path d="M8 6.5v3M8 11.5v.5" />
  </Svg>
);
export const RefreshIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
    <path d="M13.5 2.5v3h-3" />
  </Svg>
);
export const ZoomOutIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14M4.5 7h5" />
  </Svg>
);
export const ZoomInIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14M4.5 7h5M7 4.5v5" />
  </Svg>
);
export const SwapIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h8l-2.5-2.5M12 10H4l2.5 2.5" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8.5l3.5 3.5L13 5" />
  </Svg>
);
