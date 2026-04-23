import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const [routeCount, dealCount] = await Promise.all([
      prisma.route.count(),
      prisma.deal.count(),
    ]);
    return NextResponse.json({
      status: "ok",
      routes: routeCount,
      deals: dealCount,
      time: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: (e as Error).message },
      { status: 503 },
    );
  }
}
