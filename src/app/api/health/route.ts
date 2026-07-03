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
    // Log the real error server-side; never echo raw driver messages (which
    // can include hostnames/DSN fragments) on a public endpoint.
    console.error("[health] check failed:", e);
    return NextResponse.json(
      { status: "error", message: "database unreachable" },
      { status: 503 },
    );
  }
}
