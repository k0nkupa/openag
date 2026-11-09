const PATHS = {
  bell: (
    <>
      <path d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8z" />
      <path d="M6.5 14.2a1.6 1.6 0 0 0 3 0" />
    </>
  ),
  computer: (
    <>
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
      <path d="M5.5 14h5" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3" />
    </>
  ),
  automations: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </>
  ),
  connectors: (
    <>
      <path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0z" />
      <path d="M8 11.5v2" />
    </>
  ),
  bots: (
    <>
      <rect x="2.5" y="4" width="11" height="9" rx="3" />
      <path d="M8 4V1.8" />
      <circle cx="6" cy="8.5" r="0.6" fill="currentColor" />
      <circle cx="10" cy="8.5" r="0.6" fill="currentColor" />
    </>
  ),
  shield: (
    <>
      <path d="M8 1.5 13 3.5V8c0 3-2.2 5.3-5 6.5C5.2 13.3 3 11 3 8V3.5z" />
      <path d="M8 5.5v3M8 10.8v.1" />
    </>
  ),
  rooms: <path d="M3 4h10M3 8h10M3 12h6" />,
  inbox: (
    <>
      <path d="M2.5 9h3l1 2h3l1-2h3" />
      <path d="M4 3.5h8l1.5 5.5V12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9z" />
    </>
  ),
  bolt: <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z" />,
  models: (
    <>
      <rect x="4" y="4" width="8" height="8" rx="1.5" />
      <path d="M6.5 1.5V4M9.5 1.5V4M6.5 12v2.5M9.5 12v2.5M1.5 6.5H4M1.5 9.5H4M12 6.5h2.5M12 9.5h2.5" />
    </>
  ),
  memory: <path d="M3 13V3a1.5 1.5 0 0 1 1.5-1.5H13v10H4.5A1.5 1.5 0 0 0 3 13a1.5 1.5 0 0 0 1.5 1.5H13" />,
  server: (
    <>
      <rect x="2" y="2.5" width="12" height="4.5" rx="1.2" />
      <rect x="2" y="9" width="12" height="4.5" rx="1.2" />
      <path d="M4.5 4.75h.01M4.5 11.25h.01" />
    </>
  ),
  send: <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />,
} as const;

/** Thin line icon on a 16px grid (design system "Iconography"): stroke 1.4, round caps and joins. */
export function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
