import { permanentRedirect } from "next/navigation";

export default async function CommitmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    workspace?: string;
    month?: string;
    tab?: "overview" | "recurring" | "people";
  }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.workspace) query.set("workspace", params.workspace);
  if (params.month) query.set("month", params.month);
  if (params.tab === "people") query.set("tab", "people");
  permanentRedirect(
    `/financeiro/receitas-despesas${query.size ? `?${query}` : ""}`,
  );
}
