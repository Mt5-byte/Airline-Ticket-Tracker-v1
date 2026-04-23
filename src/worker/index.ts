import { Cron } from "croner";
import { runTick } from "./tick";

console.log("[worker] starting — per-minute tick scheduler");

let running = false;
const job = new Cron("* * * * *", { protect: true }, async () => {
  if (running) {
    console.log("[worker] previous tick still running; skipping");
    return;
  }
  running = true;
  const t0 = Date.now();
  try {
    await runTick();
  } catch (e) {
    console.error("[worker] tick threw:", e);
  } finally {
    running = false;
    console.log(`[worker] tick done in ${Date.now() - t0}ms`);
  }
});

// Run immediately on boot so there's no ~60s cold start gap.
(async () => {
  try {
    await runTick();
  } catch (e) {
    console.error("[worker] initial tick failed:", e);
  }
})();

function shutdown(sig: string) {
  console.log(`[worker] ${sig} received — stopping`);
  job.stop();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
