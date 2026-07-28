import { AtlasModuleLoading } from "@/components/atlas/atlas-module-loading";

export default function Loading() {
  return (
    <AtlasModuleLoading
      title="Carregando revisão da fatura"
      description="Recuperando resumo, conciliação, lançamentos e parcelamentos."
      variant="finance"
      skeletonType="invoice-review"
      className="invoice-import-loading"
    />
  );
}
