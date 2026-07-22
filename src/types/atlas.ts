export type FamilyRole = "owner" | "admin" | "member";
export type FamilyMemberStatus = "active" | "suspended" | "left";
export type FamilyInvitationStatus = "pending" | "accepted" | "rejected" | "revoked" | "expired";
export type SystemUserRole = "super_admin" | "system_admin" | "support_admin";

export interface Profile {
  id: string;
  full_name: string | null;
  preferred_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  locale: string;
  timezone: string;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface Family {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface FamilyMember {
  id: string;
  family_id: string;
  user_id: string;
  role: FamilyRole;
  status: FamilyMemberStatus;
  joined_at: string;
  created_at: string;
}

export interface FamilyInvitation {
  id: string;
  family_id: string;
  invited_email: string;
  invited_by: string;
  invited_user_id: string | null;
  role: Exclude<FamilyRole, "owner">;
  token_hash: string | null;
  status: FamilyInvitationStatus;
  expires_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface SystemUserRoleRecord {
  user_id: string;
  role: SystemUserRole;
  granted_by: string | null;
  granted_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}
