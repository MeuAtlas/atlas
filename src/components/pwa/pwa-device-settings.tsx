"use client";

import { useState } from "react";
import { usePwa } from "./pwa-context";

export function PwaDeviceSettings() {
  const pwa = usePwa();
  const [cleared, setCleared] = useState(false);
  const installAction = pwa.installAvailable
    ? pwa.install
    : pwa.iosInstallAvailable
      ? async () => pwa.openIosInstructions()
      : null;
  return (
    <section className="pwa-device-settings" aria-labelledby="pwa-device-title">
      <div><p className="eyebrow">Aplicativo</p><h2 id="pwa-device-title">Atlas neste dispositivo</h2><p>Instalação, notificações e dados locais seguros.</p></div>
      <div className="pwa-device-actions">
        {installAction ? <button type="button" onClick={installAction}>Instalar Atlas</button> : <span>{pwa.displayMode === "browser" ? "Instalação não oferecida por este navegador" : "Atlas instalado"}</span>}
        <button type="button" disabled={!pwa.pushSupported || pwa.notificationPermission === "granted" || pwa.iosInstallAvailable} onClick={pwa.requestNotificationPermission}>
          {pwa.iosInstallAvailable
            ? "Instale o Atlas para ativar notificações"
            : pwa.notificationPermission === "granted"
              ? "Notificações permitidas"
              : "Ativar notificações"}
        </button>
        <button type="button" onClick={async () => { await pwa.clearLocalAppData(); setCleared(true); }}>Limpar dados locais</button>
      </div>
      {cleared ? <p role="status">Caches estáticos e preferências de instalação foram limpos. Nenhum dado do servidor foi removido.</p> : null}
      {process.env.NODE_ENV === "development" ? (
        <details className="pwa-diagnostics"><summary>Diagnóstico do PWA</summary><dl>
          <div><dt>Modo</dt><dd>{pwa.displayMode}</dd></div>
          <div><dt>Rede</dt><dd>{pwa.networkState}</dd></div>
          <div><dt>Service worker</dt><dd>{pwa.serviceWorkerRegistered ? "registrado" : "inativo em desenvolvimento"}</dd></div>
          <div><dt>Versão</dt><dd>{pwa.workerVersion ?? "não disponível"}</dd></div>
          <div><dt>Push</dt><dd>{pwa.pushSupported ? "suportado" : "indisponível"}</dd></div>
        </dl></details>
      ) : null}
    </section>
  );
}
