"use client";

import {
  useCallback,
  type FormEvent,
  type FormHTMLAttributes,
} from "react";
import { useRouter } from "next/navigation";
import { useNavigationTransition } from "@/components/navigation/navigation-feedback";

type ClientSearchFormProps = Omit<
  FormHTMLAttributes<HTMLFormElement>,
  "action" | "method" | "onSubmit"
> & {
  action: `/${string}`;
  history?: "push" | "replace";
};

function internalPath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("A navegação interna exige um caminho relativo seguro.");
  }
  return path;
}

/**
 * Standard GET form for filters and searches.
 *
 * It keeps query parameters shareable while Next.js replaces only the route
 * payload below the shared layout. Use this instead of a native GET form for
 * every new in-app filter or search.
 */
export function ClientSearchForm({
  action,
  history = "push",
  children,
  ...props
}: ClientSearchFormProps) {
  const router = useRouter();
  const [pending, startNavigation] = useNavigationTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const submitter = "submitter" in event.nativeEvent
      ? event.nativeEvent.submitter
      : null;
    if (submitter instanceof HTMLElement) {
      const name = submitter.getAttribute("name");
      if (name) formData.append(name, submitter.getAttribute("value") ?? "");
    }

    const params = new URLSearchParams();
    formData.forEach((value, key) => {
      if (typeof value === "string" && value) params.append(key, value);
    });
    const next = `${internalPath(action)}${params.size ? `?${params}` : ""}`;
    const current = `${window.location.pathname}${window.location.search}`;
    if (next === current) return;

    startNavigation(() => {
      router[history](next, { scroll: false });
    });
  }

  return (
    <form {...props} action={action} method="get" onSubmit={submit} aria-busy={pending}>
      {children}
    </form>
  );
}

/** Standard client-side navigation for internal selectors and post-action flows. */
export function useClientNavigation() {
  const router = useRouter();
  const [, startNavigation] = useNavigationTransition();
  return useCallback((path: `/${string}`, history: "push" | "replace" = "push") => {
    const next = internalPath(path);
    const current = `${window.location.pathname}${window.location.search}`;
    if (next === current) return false;
    startNavigation(() => router[history](next, { scroll: false }));
    return true;
  }, [router, startNavigation]);
}
