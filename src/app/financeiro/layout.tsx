import { FinanceShell } from "@/components/finance/finance-shell";
import { getWorkspaces,requireFinanceAccess } from "@/modules/finance/access";
export const dynamic="force-dynamic";
export default async function Layout({children}:{children:React.ReactNode}){const [{profile},workspaces]=await Promise.all([requireFinanceAccess(),getWorkspaces()]);return <FinanceShell profile={profile} workspaces={workspaces}>{children}</FinanceShell>}
