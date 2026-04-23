import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { isValidIata } from "@/lib/airports";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  origin: z.string().length(3),
  destination: z.string().length(3),
  targetCents: z.number().int().positive().optional(),
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

  const tracked = await prisma.trackedRoute.upsert({
    where: { userId_routeId: { userId, routeId: route.id } },
    update: {
      targetCents: parsed.data.targetCents ?? null,
      targetDropPct: parsed.data.targetDropPct ?? null,
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
