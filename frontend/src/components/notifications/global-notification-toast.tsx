"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BellRing,
  CalendarClock,
  ChevronRight,
  Sparkles,
  X,
} from "lucide-react";

import { api } from "@/lib/api";
import { playNotificationSound } from "@/lib/notification-sounds";
import { cn } from "@/lib/utils";
import { useVisiblePolling } from "@/lib/use-visible-polling";

export type ToastNotification = {
  id: string;
  type: string;
  message: string;
  schedule?: string | null;
  created_at?: string;
};

const AUTO_DISMISS_MS = 6500;
const POLL_INTERVAL_MS = 60_000;

export function GlobalNotificationToast() {
  const router = useRouter();
  const [activeToasts, setActiveToasts] = useState<ToastNotification[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const isInitialFetchRef = useRef(true);

  // Poll for unread notifications across the whole app -- visible, active
  // tabs only (see useVisiblePolling), so idle tabs don't keep the DB awake.
  const checkNotifications = async () => {
    try {
      const { data } = await api.get<ToastNotification[]>("/notifications/?is_read=false");
      const fresh = data || [];

      if (isInitialFetchRef.current) {
        // Record initial existing notifications without spamming audio chimes
        fresh.forEach((n) => seenIdsRef.current.add(n.id));
        isInitialFetchRef.current = false;
        return;
      }

      // Find truly new notifications that haven't been shown as toast
      const newNotifs = fresh.filter((n) => !seenIdsRef.current.has(n.id));

      if (newNotifs.length > 0) {
        newNotifs.forEach((n) => seenIdsRef.current.add(n.id));
        playNotificationSound();
        setActiveToasts((prev) => [...prev, ...newNotifs]);
      }
    } catch {
      // Handled silently
    }
  };
  useVisiblePolling(checkNotifications, POLL_INTERVAL_MS);

  // Also listen for immediate manual test events
  useEffect(() => {
    const handleImmediateNotification = (e: Event) => {
      const customEvent = e as CustomEvent<ToastNotification>;
      if (customEvent.detail?.id) {
        seenIdsRef.current.add(customEvent.detail.id);
        playNotificationSound();
        setActiveToasts((prev) => [...prev, customEvent.detail]);
      }
    };

    window.addEventListener("avtr:toast-notification", handleImmediateNotification);
    return () => window.removeEventListener("avtr:toast-notification", handleImmediateNotification);
  }, []);

  const dismissToast = (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setActiveToasts((prev) => prev.filter((t) => t.id !== id));
    api.post(`/notifications/${id}/mark-read/`).catch(() => {});
  };

  const handleToastClick = (toast: ToastNotification) => {
    dismissToast(toast.id);
    router.push("/dashboard");
  };

  if (activeToasts.length === 0) return null;

  return (
    <div className="fixed top-5 right-5 z-[99999] flex flex-col gap-3 pointer-events-none max-w-sm sm:max-w-md w-[calc(100vw-2.5rem)]">
      {activeToasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onClick={() => handleToastClick(toast)}
          onDismiss={(e) => dismissToast(toast.id, e)}
        />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onClick,
  onDismiss,
}: {
  toast: ToastNotification;
  onClick: () => void;
  onDismiss: (e?: React.MouseEvent) => void;
}) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100);
      setProgress(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onDismiss();
      }
    }, 50);

    return () => clearInterval(interval);
  }, [onDismiss]);

  const isSchedule =
    toast.type?.includes("schedule") || toast.message?.toLowerCase().includes("schedule");

  return (
    <div
      onClick={onClick}
      className={cn(
        "pointer-events-auto group relative flex flex-col overflow-hidden rounded-2xl cursor-pointer select-none transition-all duration-300",
        // Professional Adaptive SaaS Styling (Crisp Light / Dark Glassmorphism)
        "bg-card/95 text-card-foreground border border-border/90 shadow-2xl shadow-black/10 dark:shadow-black/60 backdrop-blur-xl ring-1 ring-black/5 dark:ring-white/10",
        "hover:border-primary/50 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 animate-in slide-in-from-top-4 fade-in-0"
      )}
    >
      <div className="p-4 flex items-start gap-3.5">
        {/* Crisp Icon Badge with Live Glow */}
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl shadow-2xs border mt-0.5 transition-colors",
            isSchedule
              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
              : "bg-primary/10 text-primary border-primary/20"
          )}
        >
          {isSchedule ? (
            <CalendarClock className="size-5" />
          ) : (
            <BellRing className="size-5" />
          )}
        </div>

        {/* Content Body */}
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold font-mono uppercase tracking-wider border",
                  isSchedule
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full animate-ping",
                    isSchedule ? "bg-amber-500" : "bg-emerald-500"
                  )}
                />
                <span>{isSchedule ? "Schedule Complete" : "Live Audit Signal"}</span>
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-muted-foreground">Just now</span>
              {/* Dismiss Button */}
              <button
                type="button"
                onClick={onDismiss}
                className="flex size-6 shrink-0 items-center justify-center rounded-lg border border-transparent hover:border-border/80 hover:bg-secondary text-muted-foreground hover:text-foreground transition-all"
                title="Dismiss"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>

          <p className="text-xs font-semibold leading-relaxed text-foreground line-clamp-3">
            {toast.message}
          </p>

          <div className="flex items-center justify-between pt-1">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary group-hover:underline">
              <span>View in Dashboard</span>
              <ChevronRight className="size-3 transition-transform group-hover:translate-x-0.5" />
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              Click to inspect
            </span>
          </div>
        </div>
      </div>

      {/* Auto-dismiss progress bar on bottom */}
      <div className="h-1 w-full bg-secondary/60 overflow-hidden">
        <div
          className={cn(
            "h-full transition-all duration-75 ease-linear",
            isSchedule ? "bg-amber-500" : "bg-primary"
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
