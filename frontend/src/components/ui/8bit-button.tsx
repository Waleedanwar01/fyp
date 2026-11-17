import * as React from "react";
import { type VariantProps, cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

import { Button as ShadcnButton } from "@/components/ui/button";

// Adapted from 8bitcn's 8-bit button for this project's Base UI shadcn
// Button: Base UI has no `asChild`, so links use the shadcn `render` prop
// (e.g. render={<Link href="/x" />} nativeButton={false}), and the pixel
// border pieces are <span>s -- a <div> inside <button>/<a> is invalid HTML.

export const buttonVariants = cva("", {
  variants: {
    font: {
      normal: "",
      retro: "retro",
    },
    variant: {
      default: "bg-foreground",
      destructive: "bg-foreground",
      outline: "bg-foreground",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      ghost: "hover:bg-accent hover:text-accent-foreground",
      link: "text-primary underline-offset-4 hover:underline",
    },
    size: {
      default: "",
      sm: "",
      lg: "",
      icon: "",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export type BitButtonProps = React.ComponentProps<typeof ShadcnButton> & {
  /** "retro" (default) uses the pixel font; "normal" keeps the site font. */
  font?: "normal" | "retro";
};

const piece = "pointer-events-none absolute block bg-foreground";

function PixelFrame({ variant, size }: { variant: BitButtonProps["variant"]; size: BitButtonProps["size"] }) {
  if (size === "icon") {
    return (
      <>
        <span className={cn(piece, "top-0 left-0 h-[5px] w-full md:h-1.5")} />
        <span className={cn(piece, "bottom-0 h-[5px] w-full md:h-1.5")} />
        <span className={cn(piece, "top-1 -left-1 h-1/2 w-[5px] md:w-1.5")} />
        <span className={cn(piece, "bottom-1 -left-1 h-1/2 w-[5px] md:w-1.5")} />
        <span className={cn(piece, "top-1 -right-1 h-1/2 w-[5px] md:w-1.5")} />
        <span className={cn(piece, "-right-1 bottom-1 h-1/2 w-[5px] md:w-1.5")} />
      </>
    );
  }
  if (variant === "ghost" || variant === "link") return null;

  return (
    <>
      {/* Pixelated border */}
      <span className={cn(piece, "-top-1.5 left-1.5 h-1.5 w-1/2")} />
      <span className={cn(piece, "-top-1.5 right-1.5 h-1.5 w-1/2")} />
      <span className={cn(piece, "-bottom-1.5 left-1.5 h-1.5 w-1/2")} />
      <span className={cn(piece, "right-1.5 -bottom-1.5 h-1.5 w-1/2")} />
      <span className={cn(piece, "top-0 left-0 size-1.5")} />
      <span className={cn(piece, "top-0 right-0 size-1.5")} />
      <span className={cn(piece, "bottom-0 left-0 size-1.5")} />
      <span className={cn(piece, "right-0 bottom-0 size-1.5")} />
      <span className={cn(piece, "top-1.5 -left-1.5 h-[calc(100%-12px)] w-1.5")} />
      <span className={cn(piece, "top-1.5 -right-1.5 h-[calc(100%-12px)] w-1.5")} />
      {variant !== "outline" && (
        <>
          {/* Top shadow */}
          <span className="pointer-events-none absolute top-0 left-0 block h-1.5 w-full bg-foreground/20" />
          <span className="pointer-events-none absolute top-1.5 left-0 block h-1.5 w-3 bg-foreground/20" />
          {/* Bottom shadow */}
          <span className="pointer-events-none absolute bottom-0 left-0 block h-1.5 w-full bg-foreground/20" />
          <span className="pointer-events-none absolute right-0 bottom-1.5 block h-1.5 w-3 bg-foreground/20" />
        </>
      )}
    </>
  );
}

function Button({ children, className, variant, size, font, ...props }: BitButtonProps) {
  return (
    <ShadcnButton
      {...props}
      variant={variant}
      size={size}
      className={cn(
        "relative inline-flex items-center justify-center gap-1.5 rounded-none border-none shadow-none transition-transform active:translate-y-1",
        size === "icon" && "mx-1 my-0",
        font !== "normal" && "retro text-[11px] sm:text-xs",
        className
      )}
    >
      {children}
      <PixelFrame variant={variant} size={size} />
    </ShadcnButton>
  );
}

export { Button };

export default Button;
