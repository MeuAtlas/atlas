import { AtlasModuleLoading } from "@/components/atlas/atlas-module-loading";

export default function Loading() {
  return (
    <AtlasModuleLoading
      title="Preparando relatórios"
      description="Consolidando sua análise financeira."
      variant="finance"
      skeletonType="reports"
    />
  );
}
