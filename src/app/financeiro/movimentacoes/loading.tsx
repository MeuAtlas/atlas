import { AtlasModuleLoading } from "@/components/atlas/atlas-module-loading";

export default function Loading() {
  return (
    <AtlasModuleLoading
      title="Carregando movimentações"
      description="Sincronizando entradas e saídas."
      variant="finance"
      skeletonType="transactions"
    />
  );
}
