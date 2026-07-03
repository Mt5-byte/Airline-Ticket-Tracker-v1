import { prisma } from "../lib/db";
import { fetchDealSignals, fetchPriceQuote, hasRealProvider, sourcesStatus } from "../lib/sources";
import {
  evaluateQuote,
  evaluateSignal,
  evaluateUserTarget,
  persistDeal,
  routeBaseline,
} from "../lib/deal-engine";
import { sendDealEmail } from "../lib/email";
import { airportLabel, lookupAirport } from "../lib/airports";

const TICK_BUDGET_MS = 55_000; // leave headroom within the 60s cadence
const POLL_CONCURRENCY = 8; // don't burst every route at a rate-limited provider at once
const SAMPLE_RETENTION_DAYS = 35;
const DEAL_RETENTION_DAYS = 60;

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export async function runTick() {
  const run = await prisma.workerRun.create({ data: {} });
  const started = Date.now();
  let sampled = 0;
  let dealsNew = 0;
  let errors = 0;
  let skipped = 0;

  try {
    const routes = await prisma.route.findMany({
      where: {
        OR: [{ isCurated: true }, { trackers: { some: {} } }],
      },
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TICK_BUDGET_MS);

    try {
      // 1) Poll prices for every active route, at bounded concurrency.
      await inBatches(routes, POLL_CONCURRENCY, async (r) => {
        try {
          const quote = await fetchPriceQuote(r.origin, r.destination, controller.signal);
          if (!quote) {
            // Real provider configured but errored/rate-limited: skip the
            // sample rather than record fabricated demo data (which would
            // poison the route's baseline).
            skipped++;
            return;
          }
          await prisma.priceSample.create({
            data: {
              routeId: r.id,
              priceCents: quote.priceCents,
              currency: quote.currency,
              cabin: quote.cabin,
              carrier: quote.carrier,
              source: quote.source,
              departAt: quote.departAt,
              returnAt: quote.returnAt,
              deepLink: quote.deepLink,
            },
          });
          sampled++;

          // One baseline computation per route per tick (SQL median), shared
          // by both the baseline evaluator and every user-target check.
          const baseline = await routeBaseline(r.id);

          const baselineDeal = await evaluateQuote(r.id, quote, baseline);
          if (baselineDeal) {
            const res = await persistDeal(baselineDeal);
            if (res?.created) {
              dealsNew++;
              await notifyTrackers(r.id, res.id);
            }
          }
          const userHits = await evaluateUserTarget(r.id, quote, baseline);
          for (const u of userHits) {
            const res = await persistDeal(u);
            if (res?.created) {
              dealsNew++;
              await notifyTrackers(r.id, res.id);
            }
          }
        } catch (e) {
          errors++;
          console.warn(`[tick] ${r.origin}->${r.destination}:`, (e as Error).message);
        }
      });

      // 2) External deal signals (curated feeds + Twitter).
      const signals = await fetchDealSignals(controller.signal);
      for (const s of signals) {
        try {
          // Adapters validate codes against the airport dictionary, so this
          // only creates real (non-polled, non-curated) routes for linking.
          if (!lookupAirport(s.origin) || !lookupAirport(s.destination)) continue;
          const route = await prisma.route.upsert({
            where: { origin_destination: { origin: s.origin, destination: s.destination } },
            create: { origin: s.origin, destination: s.destination, isCurated: false },
            update: {},
            select: { id: true },
          });
          const scored = evaluateSignal(s);
          scored.routeId = route.id;
          const res = await persistDeal(scored);
          if (res?.created) {
            dealsNew++;
            await notifyTrackers(route.id, res.id);
          }
        } catch {
          errors++;
        }
      }

      // 3) Retention: once an hour, prune old samples and expired deals so the
      // per-minute append never grows the tables (and the median scans)
      // without bound.
      if (new Date().getUTCMinutes() === 0) {
        const sampleCutoff = new Date(Date.now() - SAMPLE_RETENTION_DAYS * 86_400_000);
        const dealCutoff = new Date(Date.now() - DEAL_RETENTION_DAYS * 86_400_000);
        const [prunedSamples, prunedDeals] = await Promise.all([
          prisma.priceSample.deleteMany({ where: { sampledAt: { lt: sampleCutoff } } }),
          prisma.deal.deleteMany({ where: { seenAt: { lt: dealCutoff } } }),
        ]);
        if (prunedSamples.count || prunedDeals.count) {
          console.log(
            `[tick] retention: pruned ${prunedSamples.count} samples, ${prunedDeals.count} deals`,
          );
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    errors++;
    console.error("[tick] fatal:", e);
  }

  const elapsed = Date.now() - started;
  await prisma.workerRun.update({
    where: { id: run.id },
    data: {
      endedAt: new Date(),
      sampled,
      dealsNew,
      errors,
      note: summarize(sourcesStatus(), skipped),
    },
  }).catch(() => {
    // Never let bookkeeping take down the tick.
  });
  console.log(
    `[tick] sampled=${sampled} skipped=${skipped} newDeals=${dealsNew} errors=${errors} ${elapsed}ms`,
  );
}

async function notifyTrackers(routeId: string, dealId: string) {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) return;
  // Private user-target deals alert ONLY the user whose target fired — never
  // the route's other trackers (their targets are their own business).
  const trackers = await prisma.trackedRoute.findMany({
    where: {
      routeId,
      notifyEmail: true,
      ...(deal.source === "user-target" && deal.userId ? { userId: deal.userId } : {}),
    },
    include: { user: { select: { email: true } } },
  });
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const dealUrl = `${appUrl}/deals/${dealId}`;
  for (const tr of trackers) {
    try {
      // Skip if already alerted.
      const exists = await prisma.alert.findUnique({
        where: { userId_dealId: { userId: tr.userId, dealId } },
      });
      if (exists) continue;
      const ok = await sendDealEmail({
        to: tr.user.email,
        origin: deal.originCode,
        destination: deal.destinationCode,
        priceCents: deal.priceCents,
        discountPct: deal.discountPct,
        source: deal.sourceLabel ?? deal.source,
        sourceUrl: deal.sourceUrl,
        headline: deal.headline ?? `Deal on ${airportLabel(deal.originCode)} → ${airportLabel(deal.destinationCode)}`,
        dealUrl,
      });
      if (ok) {
        await prisma.alert.create({
          data: { userId: tr.userId, dealId, channel: "email" },
        });
      }
    } catch (e) {
      console.warn("[alert] failed:", (e as Error).message);
    }
  }
}

function summarize(s: ReturnType<typeof sourcesStatus>, skipped: number) {
  const base = `duffel=${s.duffel ? "on" : "off"} amadeus=${s.amadeus ? "on" : "off"} twitter=${s.twitter ? "on" : "off"}${s.demoMode ? " (demo)" : ""}`;
  return hasRealProvider() && skipped > 0 ? `${base} skipped=${skipped}` : base;
}
