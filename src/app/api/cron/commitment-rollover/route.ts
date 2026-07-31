import { isCronAuthorized } from "@/lib/cron-auth";
import {
  runScheduledCommitmentRollover,
} from "@/modules/finance/commitment-rollover-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runScheduledCommitmentRollover();
    return Response.json({ ok: true, ...result }, { status: 200 });
  } catch {
    console.error("[Atlas Commitment Rollover]", {
      operation: "commitments.rollover",
      status: "structural_failure",
    });
    return Response.json(
      { ok: false, error: "commitment_rollover_unavailable" },
      { status: 503 },
    );
  }
}
