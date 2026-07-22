import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginCard } from "@/components/auth/login-card";
import { getAuthenticatedDestination, getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const { user, profile } = await getAuthContext();
  if (user && profile) redirect(getAuthenticatedDestination(profile));

  return (
    <AuthShell>
      <LoginCard />
    </AuthShell>
  );
}
