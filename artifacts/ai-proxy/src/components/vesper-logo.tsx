export function VesperLogo({ size = 32 }: { size?: number }) {
  return (
    <div
      className="rounded-xl bg-primary flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <svg
        width={size * 0.65}
        height={size * 0.65}
        viewBox="0 0 26 26"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M2 3 L13 23 L24 3"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary-foreground"
        />
        <circle
          cx="13"
          cy="13"
          r="2.8"
          fill="currentColor"
          className="text-primary-foreground"
        />
      </svg>
    </div>
  );
}
