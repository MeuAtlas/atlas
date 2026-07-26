import { AtlasModuleLoading } from "@/components/atlas/atlas-module-loading";

export default function Loading() {
  return (
    <AtlasModuleLoading
      title="Carregando cartões"
      description="Organizando filtros, faturas e compras."
      variant="finance"
      skeletonType="cards"
    />
  );
}
