import { AtlasModuleLoading } from "@/components/atlas/atlas-module-loading";

export default function Loading() {
  return (
    <AtlasModuleLoading
      title="Preparando sua visão financeira"
      description="Organizando os dados do mês."
      variant="finance"
      skeletonType="overview"
    />
  );
}
