import Link from "next/link";
import { ArrowRight, ExternalLink, Sparkles, Twitter, Target, TrendingDown } from "lucide-react";
import { Badge } from "./ui/badge";
import { Sparkline } from "./sparkline";
import { formatPriceCents, timeAgo } from "@/lib/format";
import { airportLabel } from "@/lib/airports";
import { cn } from "@/lib/utils";

type Deal = {
  id: string;
  originCode: string;
  destinationCode: string;
  originName?: string | null;
  destinationName?: string | null;
  priceCents?: number | null;
  currency?: string;
  baselineCents?: number | null;
  discountPct?: number | null;
  cabin?: string;
  carrier?: string | null;
  source: string;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  headline?: string | null;
  score: number;
  seenAt: string | Date;
};

const SOURCE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  baseline: TrendingDown,
  curated: Sparkles,
  twitter: Twitter,
  "user-target": Target,
};

export function DealCard({ deal, priceHistory }: { deal: Deal; priceHistory?: number[] }) {
  const Icon = SOURCE_ICON[deal.source] ?? Sparkles;
  const discount = deal.discountPct ?? null;
  const hot = discount != null && discount >= 30;

  return (
    <Link
      href={`/deals/${deal.id}`}
      className="group relative block animate-fade-in rounded-xl border border-border bg-card/60 p-5 card-lift ring-focus"
    >
      {hot && (
        <div className="absolute -top-px left-6 right-6 h-px bg-gradient-to-r from-transparent via-primary/80 to-transparent" />
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            <Icon className="h-3 w-3" />
            <span className="truncate">{deal.sourceLabel ?? deal.source}</span>
            <span className="text-muted-foreground/60">·</span>
            <span className="num">{timeAgo(deal.seenAt)}</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2 text-[15px] font-medium">
            <span className="num text-muted-foreground">{deal.originCode}</span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/70" />
            <span className="num">{deal.destinationCode}</span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground truncate">
            {(deal.originName ?? airportLabel(deal.originCode))}
            <span className="mx-1.5 text-muted-foreground/50">→</span>
            {(deal.destinationName ?? airportLabel(deal.destinationCode))}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className={cn(
            "num text-2xl font-semibold tabular-nums",
            hot ? "text-primary" : "text-foreground",
          )}>
            {deal.priceCents ? formatPriceCents(deal.priceCents, deal.currency) : "—"}
          </div>
          {deal.baselineCents && deal.priceCents && deal.baselineCents > deal.priceCents && (
            <div className="num text-[11px] text-muted-foreground line-through">
              {formatPriceCents(deal.baselineCents, deal.currency)}
            </div>
          )}
        </div>
      </div>

      {deal.headline && (
        <p className="mt-3 line-clamp-2 text-[13px] text-muted-foreground/90">
          {deal.headline}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {discount != null && (
            <Badge variant={hot ? "primary" : "success"}>
              −{Math.round(discount)}%
            </Badge>
          )}
          {deal.carrier && <Badge variant="outline">{deal.carrier}</Badge>}
          {deal.cabin && deal.cabin !== "economy" && (
            <Badge variant="outline">{deal.cabin.replace("_", " ")}</Badge>
          )}
          <Badge>score {deal.score}</Badge>
        </div>
        {priceHistory && priceHistory.length >= 2 && (
          <div className={cn("text-muted-foreground/70", hot && "text-primary/80")}>
            <Sparkline values={priceHistory} />
          </div>
        )}
        {deal.sourceUrl && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
            source <ExternalLink className="h-3 w-3" />
          </span>
        )}
      </div>
    </Link>
  );
}
