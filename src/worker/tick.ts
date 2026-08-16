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

const POLL_BUDGET_MS = 40_000; // route polling budget within the 60s cadence
const SIGNALS_BUDGET_MS = 15_000; // signals get their own budget — a slow poll phase must not starve them
const POLL_CONCURRENCY = 8; // don't burst every route at a rate-limited provider at once
const SAMPLE_RETENTION_DAYS = 35;
const DEAL_RETENTION_DAYS = 60;
const WORKER_RUN_RETENTION_DAYS = 7;
const MAX_SIGNAL_AGE_DAYS = 30; // feed items older than this never become deals

export async function runTick() {
  const run = await prisma.workerRun.create({ data: {} });
  const started = Date.now();
  let sampled = 0;
  let dealsNew = 0;
  let errors = 0;
  let skipped = 0;
  let unpolled = 0;

  try {
    const routes = await prisma.route.findMany({
      where: {
        OR: [{ isCurated: true }, { trackers: { some: {} } }],
      },
    });

    // 1) Poll prices for every active route, at bounded concurrency, stopping
    // loudly when the budget lapses so tail-route starvation is visible in
    // logs and WorkerRun instead of silently repeating every tick.
    const pollController = new AbortController();
    const pollTimeout = setTimeout(() => pollController.abort(), POLL_BUDGET_MS);
    try {
      for (let i = 0; i < routes.length; i += POLL_CONCURRENCY) {
        if (pollController.signal.aborted) {
          unpolled = routes.length - i;
          console.warn(
            `[tick] poll budget (${POLL_BUDGET_MS}ms) exceeded — ${unpolled}/${routes.length} routes unpolled this tick`,
          );
          break;
        }
        await Promise.all(
          routes.slice(i, i + POLL_CONCURRENCY).map(async (r) => {
            try {
              const quote = await fetchPriceQuote(r.origin, r.destination, pollController.signal);
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

              // Deal evaluation is USD-only: the baseline median is a USD
              // distribution, and comparing a GBP fare against it would mint
              // bogus discounts. (The sample is still stored above.)
              if (quote.currency !== "USD") return;

              // One baseline computation per route per tick (SQL median), shared
              // by both the baseline evaluator and every user-target check.
              const baseline = await routeBaseline(r.id);

              const baselineDeal = await evaluateQuote(r.id, quote, baseline);
              if (baselineDeal) {
                const res = await persistDeal(baselineDeal);
                if (res) {
                  if (res.created) dealsNew++;
                  // Notify even when the row already existed: the Alert table
                  // dedupes per (user, deal), so this retries transiently
                  // failed sends instead of losing them forever.
                  await notifyTrackers(r.id, res.id);
                }
              }
              const userHits = await evaluateUserTarget(r.id, quote, baseline);
              for (const u of userHits) {
                const res = await persistDeal(u);
                if (res) {
                  if (res.created) dealsNew++;
                  await notifyTrackers(r.id, res.id);
                }
              }
            } catch (e) {
              errors++;
              console.warn(`[tick] ${r.origin}->${r.destination}:`, (e as Error).message);
            }
          }),
        );
      }
    } finally {
      clearTimeout(pollTimeout);
    }

    if (hasRealProvider() && routes.length > 0 && sampled === 0) {
      console.warn(
        "[tick] ALL real-provider polls failed — check provider credentials/quota (no demo fallback in provider mode)",
      );
    }

    // 2) External deal signals (curated feeds + Twitter) — own budget, never
    // starved by a slow poll phase.
    const sigController = new AbortController();
    const sigTimeout = setTimeout(() => sigController.abort(), SIGNALS_BUDGET_MS);
    try {
      const signals = await fetchDealSignals(sigController.signal);
      const maxAgeMs = MAX_SIGNAL_AGE_DAYS * 86_400_000;
      for (const s of signals) {
        try {
          // Stale feed items must not become "new" deals — and after the 60-day
          // deal retention pass, a still-published old item would otherwise be
          // re-minted and re-alerted.
          if (s.seenAt && Date.now() - s.seenAt.getTime() > maxAgeMs) continue;
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
          if (res) {
            if (res.created) dealsNew++;
            await notifyTrackers(route.id, res.id);
          }
        } catch {
          errors++;
        }
      }
    } finally {
      clearTimeout(sigTimeout);
    }

    // 3) Retention: once an hour, prune old samples, deals, and worker-run
    // bookkeeping so per-minute appends never grow tables without bound.
    if (new Date().getUTCMinutes() === 0) {
      const sampleCutoff = new Date(Date.now() - SAMPLE_RETENTION_DAYS * 86_400_000);
      const dealCutoff = new Date(Date.now() - DEAL_RETENTION_DAYS * 86_400_000);
      const runCutoff = new Date(Date.now() - WORKER_RUN_RETENTION_DAYS * 86_400_000);
      const [prunedSamples, prunedDeals, prunedRuns] = await Promise.all([
        prisma.priceSample.deleteMany({ where: { sampledAt: { lt: sampleCutoff } } }),
        prisma.deal.deleteMany({ where: { seenAt: { lt: dealCutoff } } }),
        prisma.workerRun.deleteMany({ where: { startedAt: { lt: runCutoff } } }),
      ]);
      if (prunedSamples.count || prunedDeals.count || prunedRuns.count) {
        console.log(
          `[tick] retention: pruned ${prunedSamples.count} samples, ${prunedDeals.count} deals, ${prunedRuns.count} runs`,
        );
      }
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
      note: summarize(sourcesStatus(), skipped, unpolled),
    },
  }).catch(() => {
    // Never let bookkeeping take down the tick.
  });
  console.log(
    `[tick] sampled=${sampled} skipped=${skipped} unpolled=${unpolled} newDeals=${dealsNew} errors=${errors} ${elapsed}ms`,
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

function summarize(s: ReturnType<typeof sourcesStatus>, skipped: number, unpolled: number) {
  let base = `duffel=${s.duffel ? "on" : "off"} amadeus=${s.amadeus ? "on" : "off"} twitter=${s.twitter ? "on" : "off"}${s.demoMode ? " (demo)" : ""}`;
  if (skipped > 0) base += ` skipped=${skipped}`;
  if (unpolled > 0) base += ` unpolled=${unpolled}`;
  return base;
}
