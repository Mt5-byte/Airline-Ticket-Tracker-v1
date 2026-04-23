import { prisma } from "@/lib/db";
import { DealCard } from "@/components/deal-card";
import { FilterBar } from "@/components/filter-bar";
import { EmptyState } from "@/components/empty-state";
import { Plane, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { sourcesStatus } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<{ source?: string }>;

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const { source } = await searchParams;

  const where: any = { score: { gte: 50 } };
  if (source) where.source = source;

  const [deals, totalRoutes, totalDeals, lastRun] = await Promise.all([
    prisma.deal.findMany({
      where,
      orderBy: [{ score: "desc" }, { seenAt: "desc" }],
      take: 60,
    }),
    prisma.route.count(),
    prisma.deal.count(),
    prisma.workerRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);

  // Pull small price histories for baseline-type deals so cards can show sparklines.
  const routeIds = Array.from(
    new Set(deals.filter((d) => d.routeId && d.source === "baseline").map((d) => d.routeId!)),
  );
  const historyByRoute: Record<string, number[]> = {};
  if (routeIds.length) {
    const since = new Date(Date.now() - 14 * 86_400_000);
    const samples = await prisma.priceSample.findMany({
      where: { routeId: { in: routeIds }, sampledAt: { gte: since } },
      orderBy: { sampledAt: "asc" },
      select: { routeId: true, priceCents: true },
    });
    for (const s of samples) {
      (historyByRoute[s.routeId] ??= []).push(s.priceCents);
    }
  }

  const status = sourcesStatus();
  const biggest = deals[0];

  return (
    <div className="container pt-10 pb-20">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-border bg-card/40 p-8 md:p-12">
        <div className="pointer-events-none absolute -top-20 right-0 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <Badge variant="outline" className="mb-4 gap-1.5">
          <Sparkles className="h-3 w-3" /> Live · polling every 60 seconds
        </Badge>
        <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          Significantly discounted air travel,{" "}
          <span className="text-primary">surfaced the moment it drops.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground md:text-base">
          Skybird cross-references commercial flight APIs, curated deal feeds, and the deal-hunting
          corners of X — ranks every fare against its own rolling 30-day baseline — and pushes the
          outliers to the top.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Routes tracked" value={totalRoutes.toLocaleString()} />
          <Stat label="Deals found" value={totalDeals.toLocaleString()} />
          <Stat
            label="Best discount"
            value={biggest?.discountPct ? `−${Math.round(biggest.discountPct)}%` : "—"}
          />
          <Stat
            label="Last check"
            value={lastRun?.endedAt ? timeSince(new Date(lastRun.endedAt)) : "—"}
          />
        </div>
      </section>

      <section className="mt-10 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Live deal feed</h2>
          <p className="text-xs text-muted-foreground">
            Ranked by score = discount depth × absolute fare × source trust.
            {status.demoMode && " Currently running in demo mode — configure Duffel or Amadeus keys for real data."}
          </p>
        </div>
        <FilterBar />
      </section>

      <section className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {deals.length === 0 ? (
          <EmptyState
            icon={Plane}
            title="No significant deals right now"
            body="The worker is polling. Check back in a minute — the baseline needs ~10 samples per route before it can detect a dip."
            className="col-span-full"
          />
        ) : (
          deals.map((d) => (
            <DealCard
              key={d.id}
              deal={{ ...d, seenAt: d.seenAt.toISOString() } as any}
              priceHistory={d.routeId ? historyByRoute[d.routeId] : undefined}
            />
          ))
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 num text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function timeSince(d: Date) {
  const s = Math.max(1, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
