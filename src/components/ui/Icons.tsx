/**
 * A single hand-drawn icon set at one weight, so nothing in the chrome looks
 * borrowed. All icons share a 24-box, 1.5 stroke, round caps.
 */
type Props = { className?: string; filled?: boolean };

const base = "h-[1.15em] w-[1.15em]";

function Svg({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className ?? ""}`}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const ArrowLeft = ({ className }: Props) => (
  <Svg className={className}><path d="M15 5l-7 7 7 7" /></Svg>
);
export const ArrowRight = ({ className }: Props) => (
  <Svg className={className}><path d="M9 5l7 7-7 7" /></Svg>
);
export const Bookmark = ({ className, filled }: Props) => (
  <Svg className={className}>
    <path d="M6.5 4h11a1 1 0 011 1v15.2a.5.5 0 01-.78.42L12 16.6l-5.72 4.02a.5.5 0 01-.78-.42V5a1 1 0 011-1z" fill={filled ? "currentColor" : "none"} />
  </Svg>
);
export const Note = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M5 4.5h14v11.2L15.2 19.5H5z" /><path d="M19 15.5h-3.8v4" /><path d="M8.5 9h7M8.5 12.5h4.5" />
  </Svg>
);
export const Search = ({ className }: Props) => (
  <Svg className={className}><circle cx="11" cy="11" r="6" /><path d="M15.5 15.5L20 20" /></Svg>
);
export const Sparkle = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M12 3.5l1.9 5.1a2 2 0 001.5 1.5l5.1 1.9-5.1 1.9a2 2 0 00-1.5 1.5L12 20.5l-1.9-5.1a2 2 0 00-1.5-1.5L3.5 12l5.1-1.9a2 2 0 001.5-1.5z" />
  </Svg>
);
export const Mic = ({ className }: Props) => (
  <Svg className={className}>
    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3" />
  </Svg>
);
export const Play = ({ className }: Props) => (
  <Svg className={className}><path d="M8 5.5l10 6.5-10 6.5z" fill="currentColor" /></Svg>
);
export const Pause = ({ className }: Props) => (
  <Svg className={className}><path d="M9 5v14M15 5v14" strokeWidth={2} /></Svg>
);
export const Plus = ({ className }: Props) => (
  <Svg className={className}><path d="M12 5v14M5 12h14" /></Svg>
);
export const Minus = ({ className }: Props) => (
  <Svg className={className}><path d="M5 12h14" /></Svg>
);
export const Close = ({ className }: Props) => (
  <Svg className={className}><path d="M6 6l12 12M18 6L6 18" /></Svg>
);
export const Expand = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M4 9V4.5h4.5M20 9V4.5h-4.5M4 15v4.5h4.5M20 15v4.5h-4.5" />
  </Svg>
);
// Sliders, not a gear: a radial gear sits right beside the theme toggle's sun
// and the two were indistinguishable at 15px.
export const Settings = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M4 7.5h7M15 7.5h5M4 16.5h4M12 16.5h8" />
    <circle cx="13" cy="7.5" r="2.1" />
    <circle cx="10" cy="16.5" r="2.1" />
  </Svg>
);
export const Book = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M4 5.2c2.6-1 5.4-1 8 .6 2.6-1.6 5.4-1.6 8-.6v13c-2.6-1-5.4-1-8 .6-2.6-1.6-5.4-1.6-8-.6z" />
    <path d="M12 5.8v13" />
  </Svg>
);
export const Trash = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M4.5 6.5h15M9.5 6.5V4.8h5v1.7M6.5 6.5l.9 12.2a1 1 0 001 .9h7.2a1 1 0 001-.9l.9-12.2" />
  </Svg>
);
export const Check = ({ className }: Props) => (
  <Svg className={className}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>
);
export const Sun = ({ className }: Props) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.4 5.6L17 7M7 17l-1.4 1.4M18.4 18.4L17 17M7 7L5.6 5.6" />
  </Svg>
);
export const Moon = ({ className }: Props) => (
  <Svg className={className}><path d="M20 14.2A8.2 8.2 0 019.8 4 8.2 8.2 0 1020 14.2z" /></Svg>
);
export const Speaker = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M5 9.5h3l4-3.5v12l-4-3.5H5z" /><path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11" />
  </Svg>
);
export const Highlighter = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M8.5 15.5l-2 4 4-2 8.5-8.5a2.1 2.1 0 00-3-3z" /><path d="M4 21h7" />
  </Svg>
);
