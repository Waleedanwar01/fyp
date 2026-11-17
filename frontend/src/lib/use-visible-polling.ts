"use client";

import { useEffect, useRef } from "react";

const IDLE_AFTER_MS = 10 * 60 * 1000;
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

/** Calls `fn` now and then every `intervalMs` -- but only while the tab is
 * visible and the user has been active in the last 10 minutes. Background
 * or abandoned tabs stop hitting the API entirely (each request wakes the
 * database, and a serverless Postgres bills for every hour it's awake);
 * coming back to the tab refreshes immediately and resumes the timer.
 * `fn` may change between renders; the latest one is always called. */
export function useVisiblePolling(fn: () => void, intervalMs: number) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let lastActivity = Date.now();
    let idle = false;

    const active = () => document.visibilityState === "visible" && Date.now() - lastActivity < IDLE_AFTER_MS;

    const tick = () => {
      if (active()) fnRef.current();
      else idle = true;
    };
    const start = () => {
      if (timer === null) timer = setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const resume = () => {
      lastActivity = Date.now();
      if (idle && document.visibilityState === "visible") {
        idle = false;
        fnRef.current();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        resume();
        start();
      } else {
        idle = true;
        stop();
      }
    };

    fnRef.current();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, resume, { passive: true });
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, resume);
    };
  }, [intervalMs]);
}
