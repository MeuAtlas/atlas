import { AtlasModuleLoading } from "@/components/atlas/atlas-module-loading";

export default function Loading() {
  return (
    <AtlasModuleLoading
      title="Carregando movimentações"
      description="Organizando lançamentos e totais do período."
      variant="finance"
      skeletonType="transactions"
      compact
      className="movements-skeleton"
    />
  );
}
