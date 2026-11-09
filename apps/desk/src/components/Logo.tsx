/** The open-ring face (docs: design system "Logo"). Geometry thickens at small sizes so it stays legible. */
export function Logo({ size = 22 }: { size?: number }) {
  const [ring, ex, ey, ew, eh] =
    size <= 16
      ? [7, 16.5, 18, 6.5, 12]
      : size <= 24
        ? [6, 17, 18.5, 5.5, 11]
        : [5, 17.5, 19, 4.5, 10];
  const x2 = size <= 16 ? 25 : size <= 24 ? 25.5 : 26;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="shrink-0 text-foreground">
      <circle
        cx="24"
        cy="24"
        r="18"
        fill="none"
        stroke="currentColor"
        strokeWidth={ring}
        strokeLinecap="round"
        strokeDasharray="86 27.1"
        transform="rotate(-50 24 24)"
      />
      <rect x={ex} y={ey} width={ew} height={eh} rx={ew / 2} fill="currentColor" />
      <rect x={x2} y={ey} width={ew} height={eh} rx={ew / 2} fill="currentColor" />
    </svg>
  );
}
