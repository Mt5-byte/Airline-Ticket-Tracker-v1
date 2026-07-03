import { runTick } from "../../../../worker/tick";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Simple in-process overlap guard: concurrent HTTP triggers (or a platform
// scheduler double-firing) must not run two ticks at once in this process.
let running = false;

// POST-only (no GET alias): this endpoint mutates state and does real work —
// exposing it to GET invites prefetchers, crawlers, and CSRF-style triggering.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail CLOSED when unconfigured in production. An open cron endpoint lets
    // anyone burn provider API quota and hammer the DB with a curl loop.
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "CRON_SECRET is not configured; refusing unauthenticated tick" },
        { status: 503 },
      );
    }
  } else {
    const provided = req.headers.get("x-cron-secret") ?? new URL(req.url).searchParams.get("key");
    if (provided !== secret) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }
  if (running) {
    return NextResponse.json({ ok: false, reason: "tick already running" }, { status: 409 });
  }
  running = true;
  const started = Date.now();
  try {
    await runTick();
  } finally {
    running = false;
  }
  return NextResponse.json({ ok: true, ms: Date.now() - started });
}
