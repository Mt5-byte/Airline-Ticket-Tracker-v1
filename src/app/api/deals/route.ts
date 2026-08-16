import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { hasRealProvider } from "@/lib/sources";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCES = new Set(["baseline", "curated", "twitter", "user-target"]);

function num(raw: string | null, fallback: number, lo: number, hi: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback; // garbage input must not reach Prisma as NaN
  return Math.floor(Math.min(hi, Math.max(lo, n)));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sourceRaw = searchParams.get("source");
  const source = sourceRaw && SOURCES.has(sourceRaw) ? sourceRaw : undefined;
  const minScore = num(searchParams.get("minScore"), 0, 0, 100);
  const limit = num(searchParams.get("limit"), 60, 1, 200);
  const originRaw = searchParams.get("origin")?.toUpperCase();
  const origin = originRaw && /^[A-Z]{3}$/.test(originRaw) ? originRaw : undefined;

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const where: any = {
    score: { gte: minScore },
    AND: [
      // Private user-target deals are visible only to their owner.
      { OR: [{ userId: null }, ...(userId ? [{ userId }] : [])] },
      // Expired deals drop out of the feed instead of lingering until the
      // 60-day retention pass.
      { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      // Demo-era deals disappear once real providers are configured.
      ...(hasRealProvider() ? [{ isDemo: false }] : []),
    ],
  };
  if (source) where.source = source;
  if (origin) where.originCode = origin;

  const deals = await prisma.deal.findMany({
    where,
    orderBy: [{ score: "desc" }, { seenAt: "desc" }],
    take: limit,
  });
  return NextResponse.json({ deals });
}
