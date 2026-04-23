import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const source = searchParams.get("source");
  const minScore = Number(searchParams.get("minScore") ?? "0");
  const limit = Math.min(200, Number(searchParams.get("limit") ?? "60"));
  const origin = searchParams.get("origin")?.toUpperCase();

  const where: any = { score: { gte: minScore } };
  if (source) where.source = source;
  if (origin) where.originCode = origin;

  const deals = await prisma.deal.findMany({
    where,
    orderBy: [{ score: "desc" }, { seenAt: "desc" }],
    take: limit,
  });
  return NextResponse.json({ deals });
}
