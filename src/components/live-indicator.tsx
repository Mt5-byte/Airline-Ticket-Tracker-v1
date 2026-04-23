"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type SourceStatus = {
  sources: { duffel: boolean; amadeus: boolean; twitter: boolean; demoMode: boolean };
  lastRun: { at: string; sampled: number; dealsNew: number; errors: number; note?: string } | null;
};

export function LiveIndicator({ className }: { className?: string }) {
  const [status, setStatus] = useState<SourceStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/sources", { cache: "no-store" });
        if (!r.ok) return;
        const json = (await r.json()) as SourceStatus;
        if (!cancelled) setStatus(json);
      } catch {
        /* noop */
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
  const stale = freshMs != null && freshMs > 120_000;

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
            "absolute inline-flex h-full w-full rounded-full opacity-75",
            stale ? "bg-destructive animate-pulse-dot" : "bg-success animate-pulse-dot",
          )}
        />
        <span
          className={cn(
            "relative inline-flex h-1.5 w-1.5 rounded-full",
            stale ? "bg-destructive" : "bg-success",
          )}
        />
      </span>
      <span className="num">
        {stale ? "stale" : "live"} · polls every 60s
        {demo ? " · demo" : ""}
      </span>
    </div>
  );
}
