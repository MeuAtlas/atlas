"use client";

import { useEffect, useState } from "react";
import { PwaProvider, usePwa } from "./pwa-context";

function RuntimeNotices() {
  const pwa = usePwa();
  const [blocked, setBlocked] = useState(false);
  const [updateBlocked, setUpdateBlocked] = useState(false);
  useEffect(() => {
    const onBlocked = () => {
      setBlocked(true);
      window.setTimeout(() => setBlocked(false), 4000);
    };
    window.addEventListener("atlas:pwa-action-blocked", onBlocked);
    const onUpdateBlocked = () => {
      setUpdateBlocked(true);
      window.setTimeout(() => setUpdateBlocked(false), 4500);
    };
    window.addEventListener("atlas:pwa-update-blocked", onUpdateBlocked);
    return () => {
      window.removeEventListener("atlas:pwa-action-blocked", onBlocked);
      window.removeEventListener("atlas:pwa-update-blocked", onUpdateBlocked);
    };
  }, []);
  return (
    <>
      {pwa.networkState !== "online" || blocked ? (
        <aside className={`pwa-toast ${pwa.networkState === "reconnecting" ? "success" : "warning"}`} role="status" aria-live="polite">
          {blocked
            ? "Esta ação precisa de internet."
            : pwa.networkState === "offline"
              ? "Sem internet. Os dados não serão atualizados até a conexão voltar."
              : "Conexão restabelecida."}
        </aside>
      ) : null}
      {updateBlocked ? <aside className="pwa-toast warning" role="status">Conclua a ação atual antes de atualizar o Atlas.</aside> : null}
      {pwa.updateAvailable ? (
        <aside className="pwa-update-toast" role="status">
          <span><b>Nova versão disponível</b><small>Atualize quando não estiver editando ou enviando arquivos.</small></span>
          <button type="button" onClick={pwa.applyUpdate}>Atualizar agora</button>
          <button type="button" onClick={pwa.dismissUpdate}>Depois</button>
        </aside>
      ) : null}
      {(pwa.installAvailable || pwa.iosInstallAvailable) ? (
        <aside className="pwa-install-prompt">
          <span><b>Instalar Atlas</b><small>Use como aplicativo neste dispositivo.</small></span>
          <button type="button" onClick={pwa.installAvailable ? pwa.install : pwa.openIosInstructions}>Instalar</button>
        </aside>
      ) : null}
      {pwa.iosInstructionsOpen ? (
        <div className="pwa-modal-backdrop" role="presentation" onMouseDown={() => pwa.closeIosInstructions()}>
          <section className="pwa-install-modal" role="dialog" aria-modal="true" aria-labelledby="ios-install-title" onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="ios-install-title">Instalar o Atlas</h2>
            <ol>
              <li>Toque no botão Compartilhar do Safari.</li>
              <li>Escolha “Adicionar à Tela de Início”.</li>
              <li>Confirme em “Adicionar”.</li>
            </ol>
            <p>Depois, abra o Atlas pelo novo ícone.</p>
            <div><button type="button" onClick={() => pwa.closeIosInstructions()}>Agora não</button><button type="button" onClick={() => pwa.closeIosInstructions(true)}>Não mostrar novamente</button></div>
          </section>
        </div>
      ) : null}
    </>
  );
}

export function PwaRuntime({ children }: { children: React.ReactNode }) {
  return <PwaProvider>{children}<RuntimeNotices /></PwaProvider>;
}
