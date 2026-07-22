import { redirect } from "next/navigation";

import { getAuthenticatedDestination, getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ContinueAfterAuthenticationPage() {
  const { user, profile } = await getAuthContext();

  if (!user || !profile) redirect("/login");
  redirect(getAuthenticatedDestination(profile));
}
