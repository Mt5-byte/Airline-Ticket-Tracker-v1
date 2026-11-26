import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { isValidIata } from "@/lib/airports";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every tracked route becomes per-minute polling work for the worker; cap it
// so a single account can't inflate the fan-out unboundedly.
const MAX_TRACKED_ROUTES_PER_USER = 50;

const CreateSchema = z.object({
  origin: z.string().length(3),
  destination: z.string().length(3),
  // Upper bound keeps values inside Postgres INT4 and inside plausible airfare
  // territory ($100k) — without it, 3_000_000_000 passes int()+positive() and
  // crashes Prisma with a 500.
  targetCents: z.number().int().positive().max(10_000_000).optional(),
  targetDropPct: z.number().min(1).max(90).optional(),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ tracked: [] });
  const tracked = await prisma.trackedRoute.findMany({
    where: { userId },
    include: { route: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ tracked });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const origin = parsed.data.origin.toUpperCase();
  const destination = parsed.data.destination.toUpperCase();
  if (!isValidIata(origin) || !isValidIata(destination)) {
    return NextResponse.json({ error: "invalid IATA code" }, { status: 400 });
  }
  if (origin === destination) {
    return NextResponse.json({ error: "origin and destination must differ" }, { status: 400 });
  }

  const route = await prisma.route.upsert({
    where: { origin_destination: { origin, destination } },
    update: {},
    create: { origin, destination, isCurated: false },
  });

  // Cap check + upsert inside one transaction: a bare count-then-create lets
  // concurrent POSTs race past the limit (TOCTOU).
  const runTx = () =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.trackedRoute.findUnique({
        where: { userId_routeId: { userId, routeId: route.id } },
      });
      if (!existing) {
        const count = await tx.trackedRoute.count({ where: { userId } });
        if (count >= MAX_TRACKED_ROUTES_PER_USER) {
          return { limited: true as const };
        }
      }
      const tracked = await tx.trackedRoute.upsert({
        where: { userId_routeId: { userId, routeId: route.id } },
        // Only overwrite targets the caller actually sent — a re-POST without
        // targets must not silently clear an existing target. (Clearing is done
        // by removing and re-adding the route; the form says so.)
        update: {
          ...(parsed.data.targetCents !== undefined ? { targetCents: parsed.data.targetCents } : {}),
          ...(parsed.data.targetDropPct !== undefined ? { targetDropPct: parsed.data.targetDropPct } : {}),
        },
        create: {
          userId,
          routeId: route.id,
          targetCents: parsed.data.targetCents ?? null,
          targetDropPct: parsed.data.targetDropPct ?? null,
        },
        include: { route: true },
      });
      return { limited: false as const, tracked };
    }, { isolationLevel: "Serializable" });

  // Serializable transactions abort with 40001 under concurrency (two tabs, a
  // double-submit, even two different routes for the same user — the count()
  // predicate overlaps). Prisma surfaces that as P2034 and documents it as
  // retry-at-caller; the upsert's SELECT-then-INSERT can also lose a same-key
  // race as P2002, which turns into an update on re-run. Both are transient,
  // so retry instead of surfacing a 500 for an operation that would succeed.
  let result: Awaited<ReturnType<typeof runTx>> | null = null;
  for (let attempt = 1; attempt <= 3 && result === null; attempt++) {
    try {
      result = await runTx();
    } catch (e) {
      const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : null;
      if ((code !== "P2034" && code !== "P2002") || attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 25 * attempt + Math.random() * 50));
    }
  }
  if (result === null) {
    return NextResponse.json({ error: "conflict — please retry" }, { status: 409 });
  }

  if (result.limited) {
    return NextResponse.json(
      { error: `route limit reached (${MAX_TRACKED_ROUTES_PER_USER})` },
      { status: 400 },
    );
  }
  return NextResponse.json({ tracked: result.tracked });
}
