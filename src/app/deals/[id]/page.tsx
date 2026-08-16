import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { hasRealProvider } from "@/lib/sources";
import { notFound } from "next/navigation";
import { airportLabel, lookupAirport } from "@/lib/airports";
import { formatPriceCents, timeAgo, formatDateRange } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/sparkline";
import { ArrowLeft, ArrowRight, ExternalLink, Sparkles, Twitter, TrendingDown, Target } from "lucide-react";
import Link from "next/link";
import type { Deal } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSafeUrl(url: string | null): url is string {
  return Boolean(url && /^https?:\/\//i.test(url));
}

export default async function DealDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deal = await prisma.deal.findUnique({ where: { id }, include: { route: true } });
  if (!deal) return notFound();

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  // Private user-target deals exist only for their owner.
  if (deal.userId && deal.userId !== userId) return notFound();

  let history: number[] = [];
  let related: Deal[] = [];
  if (deal.routeId) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    // Hourly-averaged in SQL — a 30-day window of raw per-minute samples is
    // ~43k rows and must not be loaded into the page render. Demo-era samples
    // are excluded once real providers exist (different price distribution).
    const demoFilter = hasRealProvider() ? Prisma.sql`AND "source" <> 'demo'` : Prisma.empty;
    const rows = await prisma.$queryRaw<Array<{ h: Date; p: number }>>`
      SELECT date_trunc('hour', "sampledAt") AS h, AVG("priceCents")::float AS p
      FROM "PriceSample"
      WHERE "routeId" = ${deal.routeId} AND "sampledAt" >= ${since} ${demoFilter}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    history = rows.map((r) => r.p);
    related = await prisma.deal.findMany({
      where: {
        routeId: deal.routeId,
        id: { not: deal.id },
        AND: [
          { OR: [{ userId: null }, ...(userId ? [{ userId }] : [])] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          ...(hasRealProvider() ? [{ isDemo: false }] : []),
        ],
      },
      orderBy: { seenAt: "desc" },
      take: 4,
    });
  }

  const origin = lookupAirport(deal.originCode);
  const destination = lookupAirport(deal.destinationCode);
  const Icon =
    deal.source === "twitter"
      ? Twitter
      : deal.source === "curated"
        ? Sparkles
        : deal.source === "user-target"
          ? Target
          : TrendingDown;

  return (
    <div className="container pt-8 pb-20">
      <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> back to feed
      </Link>

      <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card/40">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_320px]">
          <div className="p-8">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
              <Icon className="h-3 w-3" />
              {deal.sourceLabel ?? deal.source}
              <span className="text-muted-foreground/60">·</span>
              {timeAgo(deal.seenAt)}
            </div>
            <h1 className="mt-3 flex flex-wrap items-baseline gap-3 text-3xl font-semibold tracking-tight md:text-4xl">
              <span className="num">{deal.originCode}</span>
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
              <span className="num">{deal.destinationCode}</span>
            </h1>
            <div className="mt-1 text-sm text-muted-foreground">
              {origin ? `${origin.city}, ${origin.country}` : airportLabel(deal.originCode)}
              <span className="mx-2 text-muted-foreground/50">→</span>
              {destination ? `${destination.city}, ${destination.country}` : airportLabel(deal.destinationCode)}
            </div>

            {deal.headline && (
              <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-foreground/90">
                {deal.headline}
              </p>
            )}
            {deal.body && (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
                {deal.body}
              </p>
            )}

            <div className="mt-6 flex flex-wrap gap-1.5">
              {deal.discountPct != null && (
                <Badge variant="primary">−{Math.round(deal.discountPct)}% vs baseline</Badge>
              )}
              {deal.carrier && <Badge variant="outline">{deal.carrier}</Badge>}
              {deal.cabin && <Badge variant="outline">{deal.cabin.replace("_", " ")}</Badge>}
              <Badge>score {deal.score}</Badge>
              {deal.departAt && (
                <Badge variant="outline">{formatDateRange(deal.departAt, deal.returnAt)}</Badge>
              )}
            </div>

            {isSafeUrl(deal.sourceUrl) && (
              <a
                href={deal.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs hover:bg-muted/70"
              >
                View source <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          <aside className="border-t border-border md:border-l md:border-t-0 p-8 bg-background/30">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Current fare</div>
            <div className="mt-1 num text-4xl font-semibold text-primary">
              {deal.priceCents ? formatPriceCents(deal.priceCents, deal.currency) : "—"}
            </div>
            {deal.baselineCents && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                Baseline: <span className="num line-through">{formatPriceCents(deal.baselineCents, deal.currency)}</span>
              </div>
            )}
            {history.length > 1 && (
              <div className="mt-6">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  Last 30 days
                </div>
                <Sparkline
                  values={history}
                  width={260}
                  height={80}
                  stroke="hsl(var(--primary))"
                  className="text-primary"
                />
              </div>
            )}
          </aside>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold">More on this route</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {related.map((r) => (
              <Link
                key={r.id}
                href={`/deals/${r.id}`}
                className="flex items-center justify-between rounded-xl border border-border bg-card/60 p-4 card-lift"
              >
                <div>
                  <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                    {r.sourceLabel ?? r.source} · {timeAgo(r.seenAt)}
                  </div>
                  <div className="mt-1 text-sm">
                    {r.headline ?? `${r.originCode} → ${r.destinationCode}`}
                  </div>
                </div>
                <div className="num text-lg font-semibold">
                  {r.priceCents ? formatPriceCents(r.priceCents, r.currency) : "—"}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
