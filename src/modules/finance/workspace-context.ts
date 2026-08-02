import { requireFinanceAccess } from "./access";

const EDIT_ROLES = new Set(["owner", "admin", "editor"]);

export type WorkspaceMembershipCandidate = {
  workspace_id: string;
  role: string;
  workspaces:
    | { type: string; owner_id: string }
    | Array<{ type: string; owner_id: string }>
    | null;
};

export function selectActiveWorkspace(
  memberships: WorkspaceMembershipCandidate[],
  userId: string,
  requestedWorkspaceId?: string | null,
) {
  const editable = memberships.filter(member =>
    EDIT_ROLES.has(String(member.role)),
  );
  const requested = requestedWorkspaceId
    ? editable.find(member => member.workspace_id === requestedWorkspaceId)
    : null;
  if (requestedWorkspaceId && !requested) return null;
  const personalOwned = editable.find(member => {
    const workspace = Array.isArray(member.workspaces)
      ? member.workspaces[0]
      : member.workspaces;
    return workspace?.type === "personal" && workspace.owner_id === userId;
  });
  return requested ?? personalOwned ?? editable[0] ?? null;
}

export async function getActiveFinanceWorkspaceContext(
  requestedWorkspaceId?: string | null,
) {
  const access = await requireFinanceAccess();
  const memberships = await access.supabase
    .from("workspace_members")
    .select("workspace_id,role,status,workspaces!inner(id,type,owner_id)")
    .eq("user_id", access.user.id)
    .eq("status", "active")
    .order("created_at");

  if (memberships.error) {
    throw new Error("Não foi possível localizar o espaço financeiro ativo.");
  }

  const active = selectActiveWorkspace(
    memberships.data ?? [],
    access.user.id,
    requestedWorkspaceId,
  );

  if (!active) {
    throw new Error("Você não possui permissão para editar este espaço financeiro.");
  }

  const membershipRole = String(active.role) as "owner" | "admin" | "editor";
  const workspaceValue = Array.isArray(active.workspaces)
    ? active.workspaces[0]
    : active.workspaces;
  const includeOwnerPrivateData = workspaceValue?.type === "personal" &&
    workspaceValue.owner_id === access.user.id;
  return {
    ...access,
    userId: access.user.id,
    workspaceId: String(active.workspace_id),
    workspaceType: workspaceValue?.type ?? "personal",
    workspaceOwnerId: workspaceValue?.owner_id ?? access.user.id,
    includeOwnerPrivateData,
    membershipRole,
    permissions: {
      canRead: true as const,
      canEdit: true as const,
      canAdmin: membershipRole === "owner" || membershipRole === "admin",
    },
  };
}
