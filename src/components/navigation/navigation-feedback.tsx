"use client";

import {
  type ComponentProps,
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type TransitionStartFunction,
} from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type NavigationFeedback = {
  begin: () => symbol;
  end: (token: symbol) => void;
  completion: number;
  loading: boolean;
};

const NavigationFeedbackContext = createContext<NavigationFeedback | null>(null);

function NavigationLinkHint() {
  const { pending } = useLinkStatus();
  return <span
    aria-hidden="true"
    className={`atlas-link-pending${pending ? " is-pending" : ""}`}
  />;
}

/**
 * Link for authenticated routes whose data is intentionally not prefetched.
 * The compact indicator acknowledges the tap immediately while the next
 * route's loading UI is prepared by the App Router.
 */
export function NavigationLink({ children, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props}>{children}<NavigationLinkHint /></Link>;
}

function NavigationCompletion({ complete }: { complete: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const signature = `${pathname}?${searchParams}`;
  const previous = useRef(signature);

  useEffect(() => {
    if (signature === previous.current) return;
    previous.current = signature;
    complete();
  }, [complete, signature]);

  return null;
}

export function NavigationFeedbackProvider({ children }: { children: ReactNode }) {
  const [tokens, setTokens] = useState<Set<symbol>>(() => new Set());
  const [completion, setCompletion] = useState(0);
  const begin = useCallback(() => {
    const token = Symbol("atlas-navigation");
    setTokens(current => new Set(current).add(token));
    return token;
  }, []);
  const end = useCallback((token: symbol) => {
    setTokens(current => {
      if (!current.has(token)) return current;
      const next = new Set(current);
      next.delete(token);
      return next;
    });
  }, []);
  const loading = tokens.size > 0;
  const complete = useCallback(() => {
    setTokens(new Set());
    setCompletion(current => current + 1);
  }, []);
  const value = useMemo(
    () => ({ begin, end, completion, loading }),
    [begin, completion, end, loading],
  );

  useEffect(() => {
    if (!loading) return;
    const timeout = window.setTimeout(complete, 30_000);
    return () => window.clearTimeout(timeout);
  }, [complete, loading]);

  return (
    <NavigationFeedbackContext value={value}>
      {children}
      <Suspense fallback={null}>
        <NavigationCompletion complete={complete} />
      </Suspense>
      {loading ? (
        <div className="atlas-navigation-overlay" role="status" aria-live="polite" aria-label="Atualizando dados">
          <div className="atlas-navigation-indicator">
            <span className="atlas-navigation-orbit" aria-hidden="true"><i /></span>
            <span>Atualizando</span>
          </div>
        </div>
      ) : null}
    </NavigationFeedbackContext>
  );
}

export function useNavigationTransition(): [boolean, TransitionStartFunction] {
  const feedback = useContext(NavigationFeedbackContext);
  const [transitionPending, startTransition] = useTransition();
  const tokenRef = useRef<symbol | null>(null);

  useEffect(() => {
    tokenRef.current = null;
  }, [feedback?.completion]);

  useEffect(() => () => {
    if (tokenRef.current && feedback) feedback.end(tokenRef.current);
  }, [feedback]);

  const startTrackedTransition = useCallback<TransitionStartFunction>((callback) => {
    if (!feedback) {
      startTransition(callback);
      return;
    }

    if (!tokenRef.current) tokenRef.current = feedback.begin();
    try {
      startTransition(callback);
    } catch (error) {
      if (tokenRef.current) feedback.end(tokenRef.current);
      tokenRef.current = null;
      throw error;
    }
  }, [feedback, startTransition]);

  return [feedback?.loading ?? transitionPending, startTrackedTransition];
}
