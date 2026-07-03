import { Cron } from "croner";
import { runTick } from "./tick";

console.log("[worker] starting — per-minute tick scheduler");

// Single overlap guard shared by BOTH the cron schedule and the boot-time
// run. (croner's `protect` only serializes cron-invoked executions — a bare
// runTick() call at boot would bypass it and could overlap the first firing.)
let running = false;

async function safeTick(trigger: string) {
  if (running) {
    console.log(`[worker] tick (${trigger}) skipped — previous tick still running`);
    return;
  }
  running = true;
  const t0 = Date.now();
  try {
    await runTick();
  } catch (e) {
    console.error(`[worker] tick (${trigger}) threw:`, e);
  } finally {
    running = false;
    console.log(`[worker] tick (${trigger}) done in ${Date.now() - t0}ms`);
  }
}

const job = new Cron("* * * * *", () => safeTick("cron"));

// Run immediately on boot so there's no ~60s cold start gap.
void safeTick("boot");

// Graceful shutdown: stop scheduling new ticks, then give an in-flight tick a
// bounded window to finish its DB writes instead of killing it mid-insert.
async function shutdown(sig: string) {
  console.log(`[worker] ${sig} received — stopping scheduler`);
  job.stop();
  const deadline = Date.now() + 15_000;
  while (running && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (running) console.warn("[worker] tick still running at shutdown deadline — exiting anyway");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
