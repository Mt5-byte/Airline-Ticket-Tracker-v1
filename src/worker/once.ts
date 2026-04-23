// Single-shot tick — useful for cron environments that invoke via HTTP or a
// platform scheduler (Railway cron, Fly machines, Vercel cron, etc.)
import { runTick } from "./tick";

runTick()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
