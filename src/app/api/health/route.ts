import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const [routeCount, dealCount, lastRun] = await Promise.all([
      prisma.route.count(),
      prisma.deal.count(),
      prisma.workerRun.findFirst({ orderBy: { startedAt: "desc" } }),
    ]);
    // Surface worker liveness without failing the check (the web service's
    // healthcheck must not die because the separate worker service is down) —
    // but make a dark provider fleet visible: sampled=0 with a note is the
    // signature of revoked credentials or exhausted quota.
    return NextResponse.json({
      status: "ok",
      routes: routeCount,
      deals: dealCount,
      worker: lastRun
        ? {
            lastTickAt: (lastRun.endedAt ?? lastRun.startedAt).toISOString(),
            sampled: lastRun.sampled,
            errors: lastRun.errors,
            note: lastRun.note,
          }
        : null,
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
