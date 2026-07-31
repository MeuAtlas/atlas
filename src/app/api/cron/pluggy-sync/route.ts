import { createPluggyCronHandler } from "@/lib/pluggy/cron-handler";
import { createScheduledPluggyDependencies } from "@/lib/pluggy/scheduled-sync-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const handleCron = createPluggyCronHandler(
  () => createScheduledPluggyDependencies(),
  {
    logStructuralFailure() {
      console.error("[Atlas Pluggy Scheduled Sync]", {
        operation: "pluggy.scheduled",
        status: "structural_failure",
      });
    },
  },
);

export async function GET(request: Request) {
  return handleCron(request);
}
