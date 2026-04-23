import { prisma } from "../lib/db";
import { fetchDealSignals, fetchPriceQuote, sourcesStatus } from "../lib/sources";
import {
  evaluateQuote,
  evaluateSignal,
  evaluateUserTarget,
  persistDeal,
} from "../lib/deal-engine";
import { sendDealEmail } from "../lib/email";
import { airportLabel } from "../lib/airports";

const TICK_BUDGET_MS = 55_000; // leave headroom within the 60s cadence

export async function runTick() {
  const run = await prisma.workerRun.create({ data: {} });
  const started = Date.now();
  let sampled = 0;
  let dealsNew = 0;
  let errors = 0;

  try {
    const routes = await prisma.route.findMany({
      where: {
        OR: [{ isCurated: true }, { trackers: { some: {} } }],
      },
      include: { _count: { select: { trackers: true } } },
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TICK_BUDGET_MS);

    // 1) Poll prices for every active route.
    await Promise.all(
      routes.map(async (r) => {
        try {
          const quote = await fetchPriceQuote(r.origin, r.destination, controller.signal);
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

          const baseline = await evaluateQuote(r.id, quote);
          if (baseline) {
            const res = await persistDeal(baseline);
            if (res?.created) {
              dealsNew++;
              await notifyTrackers(r.id, res.id);
            }
          }
          const userHits = await evaluateUserTarget(r.id, quote);
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
      }),
    );

    // 2) External deal signals (curated feeds + Twitter).
    const signals = await fetchDealSignals(controller.signal);
    for (const s of signals) {
      try {
        // Ensure route exists so deals can be linked (non-curated).
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
      } catch (e) {
        errors++;
      }
    }

    clearTimeout(timeout);
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
      note: summarize(sourcesStatus()),
    },
  });
  console.log(
    `[tick] sampled=${sampled} newDeals=${dealsNew} errors=${errors} ${elapsed}ms`,
  );
}

async function notifyTrackers(routeId: string, dealId: string) {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) return;
  const trackers = await prisma.trackedRoute.findMany({
    where: { routeId, notifyEmail: true },
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

function summarize(s: ReturnType<typeof sourcesStatus>) {
  return `duffel=${s.duffel ? "on" : "off"} amadeus=${s.amadeus ? "on" : "off"} twitter=${s.twitter ? "on" : "off"}${s.demoMode ? " (demo)" : ""}`;
}
