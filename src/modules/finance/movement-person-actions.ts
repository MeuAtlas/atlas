"use server";

import { z } from "zod";
import { requireFinanceAccess } from "./access";
import { invalidateCommitmentsCache } from "./commitments-cache";

const uuid = z.string().uuid();

async function requireMovementPersonContext(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const movementId = uuid.parse(
    data.get("movement_id") || data.get("transaction_id"),
  );
  const personId = uuid.parse(data.get("person_id"));
  const { supabase, user } = await requireFinanceAccess();
  const [workspace, person, movement] = await Promise.all([
    supabase.from("workspaces").select("id").eq("id", workspaceId).maybeSingle(),
    supabase.from("financial_people").select("id,name")
      .eq("workspace_id", workspaceId)
      .eq("id", personId)
      .neq("relation_type", "self")
      .is("archived_at", null)
      .maybeSingle(),
    supabase.from("financial_transactions")
      .select("id,workspace_id,owner_id,bank_direction,financial_nature")
      .eq("id", movementId)
      .maybeSingle(),
  ]);
  if (workspace.error || !workspace.data) {
    throw new Error("Espaço financeiro inválido.");
  }
  if (person.error || !person.data) {
    throw new Error("Pessoa não encontrada.");
  }
  if (
    movement.error ||
    !movement.data ||
    !(
      movement.data.workspace_id === workspaceId ||
      (!movement.data.workspace_id && movement.data.owner_id === user.id)
    )
  ) {
    throw new Error("Movimentação não encontrada.");
  }
  return {
    supabase,
    userId: user.id,
    workspaceId,
    movementId,
    personId,
    personName: String(person.data.name),
    movement: movement.data,
  };
}

export async function linkMovementSourceToPersonAction(data: FormData) {
  try {
    const context = await requireMovementPersonContext(data);
    const saved = await context.supabase.from("transaction_people").upsert({
      workspace_id: context.workspaceId,
      created_by: context.userId,
      transaction_id: context.movementId,
      person_id: context.personId,
      allocation_type: "full",
      allocation_value: 100,
      source: "manual",
      manually_confirmed: true,
      match_confidence: 1,
      association_scope: "current",
    }, { onConflict: "transaction_id,person_id" });
    if (saved.error) {
      throw new Error("Não foi possível associar a pessoa.");
    }
    if (
      ["pix_sent", "pix_received"].includes(
        String(context.movement.financial_nature ?? ""),
      )
    ) {
      await context.supabase.from("financial_transactions").update({
        person_flow_role: context.movement.bank_direction === "inflow"
          ? "received_from_person"
          : "sent_to_person",
      }).eq("id", context.movementId);
    }
    invalidateCommitmentsCache(context.workspaceId, {
      personId: context.personId,
    });
    return {
      ok: true as const,
      message: `Movimentação vinculada à ${context.personName}.`,
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error
        ? error.message
        : "Não foi possível associar a pessoa.",
    };
  }
}

export async function unlinkMovementSourceFromPersonAction(data: FormData) {
  try {
    const context = await requireMovementPersonContext(data);
    const removed = await context.supabase.from("transaction_people").delete()
      .eq("workspace_id", context.workspaceId)
      .eq("transaction_id", context.movementId)
      .eq("person_id", context.personId);
    if (removed.error) {
      throw new Error("Não foi possível remover a pessoa.");
    }
    invalidateCommitmentsCache(context.workspaceId, {
      personId: context.personId,
    });
    return {
      ok: true as const,
      message: "Pessoa desvinculada desta movimentação.",
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error
        ? error.message
        : "Não foi possível desvincular a pessoa.",
    };
  }
}
