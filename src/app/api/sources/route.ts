import { sourcesStatus } from "@/lib/sources";
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const latest = await prisma.workerRun.findFirst({
    orderBy: { startedAt: "desc" },
  });
  return NextResponse.json({
    sources: sourcesStatus(),
    lastRun: latest
      ? {
          at: latest.endedAt ?? latest.startedAt,
          sampled: latest.sampled,
          dealsNew: latest.dealsNew,
          errors: latest.errors,
          note: latest.note,
        }
      : null,
  });
}
