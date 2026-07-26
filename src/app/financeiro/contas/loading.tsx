import { AtlasModuleLoading } from "@/components/atlas/atlas-module-loading";

export default function Loading() {
  return (
    <AtlasModuleLoading
      title="Carregando suas contas"
      description="Atualizando saldos e conexões."
      variant="finance"
      skeletonType="accounts"
    />
  );
}
