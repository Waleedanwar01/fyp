import Image from "next/image";

import { cn } from "@/lib/utils";

/** RankLens mark: the designed PNG in public/brand (an "A" peak with an amber
 * focal dot -- the brand being *seen*). Full-size artwork for print, email
 * and social is in the same folder: ranklens-mark.png, ranklens-logo-light.png
 * (for light backgrounds) and ranklens-logo-dark.png (for dark backgrounds).
 * Decorative by default; pass `title` when it stands alone. */
export function AvtrMark({ className, title }: { className?: string; title?: string }) {
  return (
    <Image
      src="/brand/ranklens-mark-128.png"
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      width={128}
      height={128}
      priority
      className={cn("size-8 shrink-0 select-none", className)}
      draggable={false}
    />
  );
}

/** Mark + wordmark. `name` lets a white-labelled workspace show its own name. */
export function AvtrLogo({
  className,
  markClassName,
  name = "RankLens",
  textClassName,
}: {
  className?: string;
  markClassName?: string;
  name?: string;
  textClassName?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <AvtrMark className={markClassName} />
      <span className={cn("text-base font-semibold tracking-tight text-foreground", textClassName)}>{name}</span>
    </span>
  );
}
