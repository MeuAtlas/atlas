import { AtlasModuleLoading } from "@/components/atlas/atlas-module-loading";

export default function Loading() {
  return (
    <AtlasModuleLoading
      title="Calculando projeções"
      description="Organizando os próximos meses."
      variant="finance"
      skeletonType="planning"
    />
  );
}
