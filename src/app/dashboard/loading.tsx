import { AtlasModuleLoading } from "@/components/atlas/atlas-module-loading";
import { PrivateShell } from "@/components/atlas/private-shell";

export default function Loading() {
  return (
    <PrivateShell>
      <AtlasModuleLoading
        title="Preparando seu Atlas"
        description="Carregando os módulos disponíveis para você."
        variant="default"
        skeletonType="cards"
      />
    </PrivateShell>
  );
}
