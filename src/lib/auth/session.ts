import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/atlas";
import { throwSupabaseError } from "@/lib/errors";

const PROFILE_COLUMNS = "id, full_name, preferred_name, avatar_url, phone, locale, timezone, onboarding_completed, is_super_admin, status, created_at, updated_at";

function metadataText(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function findOrCreateProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: User,
) {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();

  if (error) throwSupabaseError(error, "carregar perfil (profiles)", "Não foi possível carregar o perfil do Atlas.");
  if (data) return data as Profile;

  const { data: created, error: createError } = await supabase
    .from("profiles")
    .insert({
      id: user.id,
      full_name: metadataText(user.user_metadata, "full_name"),
      preferred_name: metadataText(user.user_metadata, "preferred_name"),
    })
    .select(PROFILE_COLUMNS)
    .single();

  if (createError) throwSupabaseError(createError, "criar perfil (profiles)", "Não foi possível preparar o perfil do Atlas.");
  if (!created) throw new Error("Não foi possível preparar o perfil do Atlas.");

  return created as Profile;
}

export async function getAuthContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { supabase, user: null, profile: null };

  const profile = await findOrCreateProfile(supabase, user);
  return { supabase, user, profile };
}

export function getAuthenticatedDestination(profile: Profile) {
  return profile.onboarding_completed ? "/dashboard" : "/onboarding";
}

export async function isCurrentUserSuperAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const { data, error } = await supabase.rpc("is_super_admin");

  if (error) return false;
  return data === true;
}
