import { isCronAuthorized } from "@/lib/cron-auth";
import {
  executeScheduledPluggySync,
  type ScheduledPluggySyncDependencies,
} from "./scheduled-sync";

type CronHandlerOptions = {
  getSecret?: () => string | undefined;
  logStructuralFailure?: () => void;
};

export function createPluggyCronHandler(
  dependencies:
    | ScheduledPluggySyncDependencies
    | (() => ScheduledPluggySyncDependencies),
  options: CronHandlerOptions = {},
) {
  return async function handlePluggyCron(request: Request) {
    if (!isCronAuthorized(
      request,
      (options.getSecret ?? (() => process.env.CRON_SECRET))(),
    )) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    try {
      const resolvedDependencies =
        typeof dependencies === "function" ? dependencies() : dependencies;
      const result = await executeScheduledPluggySync(resolvedDependencies);
      return Response.json({ ok: true, ...result }, { status: 200 });
    } catch {
      options.logStructuralFailure?.();
      return Response.json(
        { ok: false, error: "scheduled_sync_unavailable" },
        { status: 503 },
      );
    }
  };
}
