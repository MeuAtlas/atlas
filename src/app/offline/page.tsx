import Link from "next/link";
import { AtlasLogo } from "@/components/atlas/atlas-logo";

export default function OfflinePage() {
  return (
    <main className="pwa-offline-page safe-area-all">
      <section>
        <AtlasLogo size={64} priority />
        <h1>Você está sem conexão</h1>
        <p>O Atlas precisa de internet para atualizar suas informações com segurança.</p>
        <small>Seus dados não foram alterados. Saldos, movimentações e faturas não são considerados atualizados enquanto você estiver offline.</small>
        <Link href="/" prefetch={false}>Tentar novamente</Link>
      </section>
    </main>
  );
}
