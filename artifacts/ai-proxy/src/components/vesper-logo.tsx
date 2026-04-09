export function VesperLogo({ size = 32 }: { size?: number }) {
  return (
    <div
      className="rounded-xl bg-primary/15 dark:bg-primary text-primary dark:text-primary-foreground flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <svg
        width={size * 0.58}
        height={size * 0.58}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Narrower V — arms go from (6,4) and (18,4) down to (12,22) */}
        <path
          d="M6 4 L12 22 L18 4"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Dot at the top-center between the two arms, at y=4 */}
        <circle cx="12" cy="4" r="2.5" fill="currentColor" />
      </svg>
    </div>
  );
}
