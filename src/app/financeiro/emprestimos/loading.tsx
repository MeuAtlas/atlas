import { AtlasModuleLoading } from "@/components/atlas/atlas-module-loading";

export default function Loading() {
  return (
    <AtlasModuleLoading
      title="Carregando empréstimos"
      description="Atualizando contratos e parcelas."
      variant="finance"
      skeletonType="loans"
    />
  );
}
