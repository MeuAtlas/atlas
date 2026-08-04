import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function redirectTo(path: string) {
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: path },
  });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

function loginErrorPath(error: string) {
  return `/login?error=${encodeURIComponent(error)}`;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password || email.length > 254 || password.length > 1024) {
    return redirectTo(loginErrorPath("invalid_credentials"));
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (!error) {
      return redirectTo("/auth/continue");
    }

    const normalizedError = `${error.code ?? ""} ${error.message}`.toLowerCase();
    const reason =
      normalizedError.includes("rate_limit") ||
      normalizedError.includes("rate limit") ||
      normalizedError.includes("too many")
        ? "rate_limited"
        : normalizedError.includes("email_not_confirmed") ||
            normalizedError.includes("email not confirmed")
          ? "email_not_confirmed"
          : normalizedError.includes("invalid_credentials") ||
              normalizedError.includes("invalid login credentials")
          ? "invalid_credentials"
          : "unavailable";

    return redirectTo(loginErrorPath(reason));
  } catch {
    return redirectTo(loginErrorPath("unavailable"));
  }
}
