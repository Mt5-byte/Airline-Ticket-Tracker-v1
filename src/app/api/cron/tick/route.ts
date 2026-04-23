import { runTick } from "../../../../worker/tick";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret") ?? new URL(req.url).searchParams.get("key");
  if (secret && secret !== provided) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const started = Date.now();
  await runTick();
  return NextResponse.json({ ok: true, ms: Date.now() - started });
}

export const GET = POST;
