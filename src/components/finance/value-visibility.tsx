"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { EyeIcon, EyeOffIcon } from "@/components/atlas/icons";
import { formatCurrency } from "@/modules/finance/format";

type ValueVisibilityContext = {
  hidden: boolean;
  toggle: () => void;
};

const Context = createContext<ValueVisibilityContext>({
  hidden: false,
  toggle: () => undefined,
});

const STORAGE_KEY = "atlas.finance.values-hidden";

export function ValueVisibility({
  children,
  controls = true,
}: {
  children: React.ReactNode;
  controls?: boolean;
}) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setHidden(window.localStorage.getItem(STORAGE_KEY) === "true");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const toggle = () => {
    setHidden((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  return (
    <Context.Provider value={{ hidden, toggle }}>
      {controls ? <ValueVisibilityButton className="finance-eye" /> : null}
      {children}
    </Context.Provider>
  );
}

export function useValuesHidden() {
  return useContext(Context).hidden;
}

export function ValueVisibilityButton({
  className = "",
}: {
  className?: string;
}) {
  const { hidden, toggle } = useContext(Context);
  return (
    <button
      type="button"
      className={className}
      onClick={toggle}
      aria-pressed={hidden}
      aria-label={hidden ? "Mostrar valores monetários" : "Ocultar valores monetários"}
    >
      {hidden ? <EyeOffIcon /> : <EyeIcon />}
      <span>{hidden ? "Mostrar valores" : "Ocultar valores"}</span>
    </button>
  );
}

export function Money({
  value,
  className,
  signed = false,
}: {
  value: number;
  className?: string;
  signed?: boolean;
}) {
  const hidden = useValuesHidden();
  const formatted = formatCurrency(value, hidden);
  return (
    <span className={className}>
      {!hidden && signed && value > 0 ? "+ " : ""}
      {formatted}
    </span>
  );
}
