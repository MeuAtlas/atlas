"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Workspace } from "@/types/atlas";

const FinanceWorkspaceContext = createContext<Workspace[]>([]);

export function FinanceWorkspaceProvider({
  children,
  workspaces,
}: {
  children: ReactNode;
  workspaces: Workspace[];
}) {
  return (
    <FinanceWorkspaceContext.Provider value={workspaces}>
      {children}
    </FinanceWorkspaceContext.Provider>
  );
}

export function useFinanceWorkspaces() {
  return useContext(FinanceWorkspaceContext);
}
