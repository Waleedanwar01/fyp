"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type CommandItem = {
  href: string;
  label: string;
  group: string;
  icon: React.ComponentType<{ className?: string }>;
};

/** ⌘K / Ctrl+K quick navigator over the app's real routes -- every entry
 * is a page that exists, so it's a genuine shortcut, not decoration. */
export function CommandPalette({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q));
  }, [items, query]);

  // Reset on open -- adjusting state during render for a prop change.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setActive(0);
    }
  }

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const go = (item: CommandItem | undefined) => {
    if (!item) return;
    onOpenChange(false);
    router.push(item.href);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-[18%] translate-y-0 gap-0 p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Jump to page</DialogTitle>
        <div className="flex items-center gap-3 border-b border-border/70 px-4">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(filtered[active]);
              }
            }}
            placeholder="Jump to a page…"
            aria-label="Search pages"
            className="h-14 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded-md border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-2" role="listbox" aria-label="Pages">
          {filtered.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">No pages match “{query}”.</li>
          )}
          {filtered.map((item, i) => {
            const Icon = item.icon;
            const isActive = i === active;
            return (
              <li key={item.href} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(item)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    isActive ? "bg-muted text-foreground" : "text-muted-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 items-center justify-center rounded-lg border transition-colors",
                      isActive
                        ? "border-border bg-background text-foreground"
                        : "border-border bg-secondary/60 text-muted-foreground"
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="flex-1 font-medium">{item.label}</span>
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70">{item.group}</span>
                  {isActive && <CornerDownLeft className="size-3.5 text-muted-foreground" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
