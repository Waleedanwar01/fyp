"use client";

import { cn } from "@/lib/utils";

/** A 270° arc gauge for a 0-1 score. `null` renders an empty track with an
 * em dash -- "no data yet" stays visibly different from a real 0%. */
export function VisibilityGauge({
  value,
  label,
  size = 200,
  className,
}: {
  value: number | null;
  label: string;
  size?: number;
  className?: string;
}) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const arc = circumference * 0.75; // 270° sweep
  const clamped = value === null ? 0 : Math.max(0, Math.min(1, value));
  const pctText = value === null ? "—" : `${Math.round(clamped * 100)}%`;

  return (
    <div className={cn("relative", className)} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="rotate-[135deg]"
        role="img"
        aria-label={`${label}: ${pctText}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${circumference}`}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arc * clamped} ${circumference}`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-semibold tracking-tight tabular-nums text-foreground">{pctText}</span>
        <span className="mt-1 text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
