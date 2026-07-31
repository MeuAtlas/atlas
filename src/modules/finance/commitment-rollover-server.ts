import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { persistCommitmentOccurrences } from "./commitment-occurrence-service";
import { invalidateCommitmentsCache } from "./commitments-cache";
import { mapCommitment } from "./commitments-query";

export async function runScheduledCommitmentRollover() {
  const supabase = createAdminClient();
  const result = await supabase.from("financial_commitments")
    .select("*")
    .eq("status", "active")
    .eq("generates_future_projections", true)
    .is("archived_at", null)
    .order("workspace_id", { ascending: true });
  if (result.error) throw new Error("commitment_rollover_unavailable");

  const rows = result.data ?? [];
  const workspaces = new Set<string>();
  let generated = 0;
  let pruned = 0;
  let failed = 0;
  const concurrency = 3;

  for (let index = 0; index < rows.length; index += concurrency) {
    const batch = rows.slice(index, index + concurrency);
    const outcomes = await Promise.allSettled(batch.map(async row => {
      const commitment = mapCommitment(
        row as unknown as Parameters<typeof mapCommitment>[0],
      );
      const persisted = await persistCommitmentOccurrences({
        supabase,
        userId: String(row.created_by),
        commitment,
      });
      workspaces.add(commitment.workspaceId);
      return persisted;
    }));
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") {
        generated += outcome.value.generated;
        pruned += outcome.value.pruned;
      } else {
        failed += 1;
      }
    }
  }

  workspaces.forEach(workspaceId =>
    invalidateCommitmentsCache(workspaceId)
  );
  console.info("[Atlas Commitment Rollover]", {
    operation: "commitments.rollover",
    processed: rows.length,
    generated,
    pruned,
    failed,
  });
  return {
    processed: rows.length,
    generated,
    pruned,
    failed,
    status: failed ? "completed_with_warnings" : "completed",
  } as const;
}
