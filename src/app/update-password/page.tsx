import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { UpdatePasswordCard } from "@/components/auth/update-password-card";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <AuthShell><UpdatePasswordCard /></AuthShell>;
}
