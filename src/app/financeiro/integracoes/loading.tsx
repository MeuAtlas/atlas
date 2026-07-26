import { AtlasModuleLoading } from "@/components/atlas/atlas-module-loading";

export default function Loading() {
  return (
    <AtlasModuleLoading
      title="Verificando integrações"
      description="Consultando o status das conexões."
      variant="finance"
      skeletonType="integrations"
    />
  );
}
