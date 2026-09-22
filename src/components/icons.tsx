/** SF-Symbols-flavored stroke icons. No emoji anywhere in the UI. */

type P = { size?: number; className?: string };

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: "false" as const,
  };
}

export const ChatIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

export const HistoryIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 12h4l2-7 4 14 2-7h6" />
  </svg>
);

export const InsightsIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </svg>
);

export const SettingsIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
  </svg>
);

export const MicIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" />
  </svg>
);

export const ReceiptIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 2.5h12v19l-2.4-1.6-2.4 1.6-1.2-.8-1.2.8-2.4-1.6L6 21.5v-19z" />
    <path d="M9 7.5h6M9 11h6M9 14.5h4" />
  </svg>
);

export const SendIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4.5 12h13M12 5.5l6.5 6.5-6.5 6.5" />
  </svg>
);

export const CheckIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
);

export const SwapIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 8h13M13.5 4.5L17 8l-3.5 3.5M20 16H7M10.5 12.5L7 16l3.5 3.5" />
  </svg>
);

export const XIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const FilterIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </svg>
);

export const ShieldIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 2.5l7.5 3v6c0 5-3.2 8.5-7.5 10-4.3-1.5-7.5-5-7.5-10v-6l7.5-3z" />
    <path d="M9 12l2 2 4-4.5" />
  </svg>
);

export const LockIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </svg>
);

export const ArrowIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const SparkIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3z" />
  </svg>
);

export const UserIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
  </svg>
);

export const CameraIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 8.5a2 2 0 0 1 2-2h1.6l1.2-1.8h6.4l1.2 1.8H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8.5z" />
    <circle cx="12" cy="12.5" r="3.4" />
  </svg>
);

export const RepeatIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4.5 9.5A6.5 6.5 0 0 1 16 5.6M19.5 14.5A6.5 6.5 0 0 1 8 18.4" />
    <path d="M16.5 2.5v3.4h-3.4M7.5 21.5v-3.4h3.4" />
  </svg>
);

export const TargetIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r="0.6" fill="currentColor" />
  </svg>
);

export const SlidersIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h9M17 17h3" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="15" cy="17" r="2" />
  </svg>
);

export const BookIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 5.2A1.7 1.7 0 0 1 5.7 3.5H11v16H5.7A1.7 1.7 0 0 0 4 21.2V5.2z" />
    <path d="M20 5.2a1.7 1.7 0 0 0-1.7-1.7H13v16h5.3A1.7 1.7 0 0 1 20 21.2V5.2z" />
  </svg>
);

export const PlusIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const TrashIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2A1.8 1.8 0 0 0 9.2 21h5.6a1.8 1.8 0 0 0 1.8-1.8L17.5 7" />
  </svg>
);

export const ChevronRightIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9.5 5.5L16 12l-6.5 6.5" />
  </svg>
);

export const ChevronLeftIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M14.5 5.5L8 12l6.5 6.5" />
  </svg>
);

export const PencilIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
    <path d="M14.5 5.5l3 3" />
  </svg>
);

export const CalendarIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

export const ClockIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const HomeIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 10.5L12 4l8 6.5V19a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 19v-8.5z" />
    <path d="M9.5 20.8v-6h5v6" />
  </svg>
);

export const IncomeIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </svg>
);

export const WalletIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a1.5 1.5 0 0 1 1.5 1.5v1" />
    <rect x="3.5" y="7.5" width="17" height="11.5" rx="2.5" />
    <circle cx="16" cy="13.2" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

export const ImageIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M3.5 16.5l4.5-4 3.5 3 3.5-3.5 5.5 4.5" />
  </svg>
);
