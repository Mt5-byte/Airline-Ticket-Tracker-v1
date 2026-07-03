import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { isValidIata } from "@/lib/airports";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
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

  const existing = await prisma.trackedRoute.findUnique({
    where: { userId_routeId: { userId, routeId: route.id } },
  });
  if (!existing) {
    const count = await prisma.trackedRoute.count({ where: { userId } });
    if (count >= MAX_TRACKED_ROUTES_PER_USER) {
      return NextResponse.json(
        { error: `route limit reached (${MAX_TRACKED_ROUTES_PER_USER})` },
        { status: 400 },
      );
    }
  }

  const tracked = await prisma.trackedRoute.upsert({
    where: { userId_routeId: { userId, routeId: route.id } },
    // Only overwrite targets the caller actually sent — a re-POST without
    // targets must not silently clear an existing target. (Clearing is done
    // by removing and re-adding the route.)
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
  return NextResponse.json({ tracked });
}
