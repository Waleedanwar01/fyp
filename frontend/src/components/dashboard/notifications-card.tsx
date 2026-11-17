"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Calendar,
  CalendarClock,
  Check,
  CheckCheck,
  Clock,
  Play,
  Radio,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useVisiblePolling } from "@/lib/use-visible-polling";
import { cn } from "@/lib/utils";
import {
  getNotificationSoundSetting,
  isNotificationSoundEnabled,
  playNotificationSound,
  setNotificationSoundEnabled,
  type NotificationSoundType,
} from "@/lib/notification-sounds";

type NotificationRecord = {
  id: string;
  type: string;
  message: string;
  schedule: string | null;
  is_read: boolean;
  created_at: string;
};

const POLL_INTERVAL_MS = 60_000;

function formatNotificationTime(dateString: string) {
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return { label: dateString, time: "" };

    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();

    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const monthDayStr = d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });

    if (isToday) {
      return {
        badge: "Today",
        dateStr: monthDayStr,
        time: timeStr,
        fullFormatted: `Today at ${timeStr}`,
      };
    }
    if (isYesterday) {
      return {
        badge: "Yesterday",
        dateStr: monthDayStr,
        time: timeStr,
        fullFormatted: `Yesterday at ${timeStr}`,
      };
    }
    return {
      badge: monthDayStr,
      dateStr: monthDayStr,
      time: timeStr,
      fullFormatted: `${monthDayStr} • ${timeStr}`,
    };
  } catch {
    return { badge: "", dateStr: "", time: dateString, fullFormatted: dateString };
  }
}

/**
 * Format notification text into styled highlighted elements
 */
function HighlightedMessage({ text }: { text: string }) {
  // If text contains "for <ClientName> just started running -- <N> Prompt Runs"
  // let's emphasize the numbers and keywords
  return (
    <span className="text-xs font-medium text-foreground leading-relaxed">
      {text}
    </span>
  );
}

export function NotificationsCard() {
  const [notifications, setNotifications] = useState<NotificationRecord[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [currentSound, setCurrentSound] = useState<NotificationSoundType>("modern_chime");
  const previousCountRef = useRef<number | null>(null);

  useEffect(() => {
    setSoundEnabled(isNotificationSoundEnabled());
    setCurrentSound(getNotificationSoundSetting());

    const handleSoundChange = (e: Event) => {
      const customEvent = e as CustomEvent<NotificationSoundType>;
      if (customEvent.detail) setCurrentSound(customEvent.detail);
    };

    const handleEnabledChange = (e: Event) => {
      const customEvent = e as CustomEvent<boolean>;
      if (customEvent.detail !== undefined) setSoundEnabled(customEvent.detail);
    };

    window.addEventListener("avtr:notification-sound-changed", handleSoundChange);
    window.addEventListener("avtr:notification-sound-enabled-changed", handleEnabledChange);

    return () => {
      window.removeEventListener("avtr:notification-sound-changed", handleSoundChange);
      window.removeEventListener("avtr:notification-sound-enabled-changed", handleEnabledChange);
    };
  }, []);

  // Visible, active tabs only (see useVisiblePolling).
  useVisiblePolling(() => {
      api
        .get<NotificationRecord[]>("/notifications/?is_read=false")
        .then(({ data }) => {
          const fresh = data || [];
          if (previousCountRef.current !== null && fresh.length > previousCountRef.current) {
            playNotificationSound();
          }
          previousCountRef.current = fresh.length;
          setNotifications(fresh);
        })
        .catch(() => setNotifications((prev) => prev ?? []));
  }, POLL_INTERVAL_MS);

  const dismiss = async (id: string) => {
    setBusyId(id);
    try {
      await api.post(`/notifications/${id}/mark-read/`);
      setNotifications((prev) => {
        const next = (prev ?? []).filter((n) => n.id !== id);
        previousCountRef.current = next.length;
        return next;
      });
    } catch {
      // Handled silently
    } finally {
      setBusyId(null);
    }
  };

  const dismissAll = async () => {
    setBusyId("all");
    try {
      await api.post("/notifications/mark-all-read/");
      setNotifications([]);
      previousCountRef.current = 0;
    } catch {
      // Handled silently
    } finally {
      setBusyId(null);
    }
  };

  const testChime = () => {
    playNotificationSound();
  };

  if (notifications === null) return null;

  return (
    <Card className="overflow-hidden">
      {/* Top Header */}
      <CardHeader className="border-b border-border px-5 pt-0 pb-4">
        {/* Row 1: Title & Unread Count */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="relative flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Bell className="size-4" />
              {notifications.length > 0 && (
                <span className="absolute -top-1 -right-1 flex size-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-primary border-2 border-card" />
                </span>
              )}
            </div>
            <div>
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-1.5">
                <span>Alerts</span>
                {notifications.length > 0 && (
                  <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    {notifications.length} New
                  </span>
                )}
              </CardTitle>
            </div>
          </div>

          {/* Mark All Read Button */}
          {notifications.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={dismissAll}
              disabled={busyId === "all"}
              className="h-7 px-2.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg gap-1 shrink-0"
            >
              <CheckCheck className="size-3 text-primary" />
              <span>Mark all read</span>
            </Button>
          )}
        </div>

        {/* Row 2: Subtitle & Sound Chime Preview Pill */}
        <div className="flex items-center justify-between pt-2 text-xs">
          <CardDescription className="text-[11px] text-muted-foreground truncate max-w-[200px] sm:max-w-none">
            Prompt runs and schedule updates
          </CardDescription>

          <button
            type="button"
            onClick={testChime}
            title={`Preview alert tone (${currentSound.replace("_", " ")})`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Volume2 className={cn("size-3", !soundEnabled && "opacity-50")} />
            <span className="capitalize">{currentSound.replace("_", " ")}</span>
          </button>
        </div>
      </CardHeader>

      {/* Card Body & Notifications List */}
      <CardContent className="px-5">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-4 text-center">
            <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Check className="size-4" />
            </div>
            <div className="flex flex-col gap-0.5 max-w-xs">
              <p className="text-sm font-medium text-foreground">You&apos;re all caught up</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                New prompt runs and schedule results will appear here.
              </p>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5 max-h-[380px] overflow-y-auto pr-1 no-scrollbar">
            {notifications.map((n) => {
              const timing = formatNotificationTime(n.created_at);
              const isSchedule = n.type?.includes("schedule") || n.message?.toLowerCase().includes("schedule");

              return (
                <li
                  key={n.id}
                  className="group relative flex flex-col gap-2.5 rounded-lg border border-border p-3 text-xs transition-colors hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/15 text-primary shadow-2xs">
                        {isSchedule ? (
                          <CalendarClock className="size-3.5" />
                        ) : (
                          <Sparkles className="size-3.5" />
                        )}
                      </div>
                      <div className="flex flex-col gap-1 min-w-0">
                        <HighlightedMessage text={n.message} />

                        {/* Date & Time Badges */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <span className="inline-flex items-center gap-1 rounded-md bg-secondary/80 px-1.5 py-0.5 font-medium border border-border/60 text-[10.5px] text-muted-foreground">
                            <Calendar className="size-2.5 text-primary/80" />
                            <span>{timing.dateStr}</span>
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-md bg-secondary/80 px-1.5 py-0.5 font-mono text-[10px] font-medium border border-border/60 text-muted-foreground">
                            <Clock className="size-2.5 text-muted-foreground/80" />
                            <span>{timing.time}</span>
                          </span>
                          {timing.badge === "Today" && (
                            <span className="inline-flex items-center rounded-md bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-[9.5px] font-bold text-emerald-600 dark:text-emerald-400">
                              Today
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => dismiss(n.id)}
                      disabled={busyId === n.id}
                      className="h-6 w-6 p-0 text-muted-foreground opacity-60 hover:opacity-100 hover:text-foreground shrink-0 rounded-md hover:bg-secondary transition-all"
                      title="Dismiss notification"
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
