"use client";

import { Sparkles, TrendingDown, Twitter, Target, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

type Filter = {
  label: string;
  value: string | null;
  icon: React.ComponentType<{ className?: string }>;
};

const FILTERS: Filter[] = [
  { label: "All", value: null, icon: Globe },
  { label: "Mistake fares", value: "baseline", icon: TrendingDown },
  { label: "Curated", value: "curated", icon: Sparkles },
  { label: "Twitter", value: "twitter", icon: Twitter },
  { label: "Your targets", value: "user-target", icon: Target },
];

export function FilterBar() {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const active = sp.get("source");

  const setFilter = (v: string | null) => {
    const params = new URLSearchParams(sp);
    if (v) params.set("source", v);
    else params.delete("source");
    start(() => router.push(`/?${params.toString()}`));
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {FILTERS.map((f) => {
        const is = active === f.value || (f.value === null && !active);
        return (
          <button
            key={f.label}
            onClick={() => setFilter(f.value)}
            disabled={pending}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
              is
                ? "border-foreground/80 bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <f.icon className="h-3 w-3" />
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
