"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type SourceStatus = {
  sources: { duffel: boolean; amadeus: boolean; twitter: boolean; demoMode: boolean };
  lastRun: { at: string; sampled: number; dealsNew: number; errors: number; note?: string } | null;
};

type FetchState = "loading" | "ok" | "error";

export function LiveIndicator({ className }: { className?: string }) {
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>("loading");

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/sources", { cache: "no-store" });
        if (cancelled) return;
        if (!r.ok) {
          setFetchState("error");
          return;
        }
        const json = (await r.json()) as SourceStatus;
        if (!cancelled) {
          setStatus(json);
          setFetchState("ok");
        }
      } catch {
        if (!cancelled) setFetchState("error");
      }
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const demo = status?.sources.demoMode;
  const lastRunAt = status?.lastRun?.at ? new Date(status.lastRun.at) : null;
  const freshMs = lastRunAt ? Date.now() - lastRunAt.getTime() : null;
  // "live" requires evidence: a successful status fetch AND a worker run in the
  // last 2 minutes. Unknown or failing must not render the green dot.
  const state: "live" | "stale" | "connecting" =
    fetchState === "loading"
      ? "connecting"
      : fetchState === "error" || freshMs == null || freshMs > 120_000
        ? "stale"
        : "live";

  const dotColor =
    state === "live" ? "bg-success" : state === "stale" ? "bg-destructive" : "bg-muted-foreground";

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border border-border bg-card/60 px-2.5 py-1 text-[11px] text-muted-foreground",
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span
          className={cn(
            "absolute inline-flex h-full w-full rounded-full opacity-75 animate-pulse-dot",
            dotColor,
          )}
        />
        <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", dotColor)} />
      </span>
      <span className="num">
        {state === "connecting" ? "connecting" : state} · polls every 60s
        {demo ? " · demo" : ""}
      </span>
    </div>
  );
}
