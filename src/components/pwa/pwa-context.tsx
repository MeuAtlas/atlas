"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  canShowIosInstall,
  detectPwaDisplayMode,
  isIosDevice,
  isSafariBrowser,
  type PwaDisplayMode,
} from "@/lib/pwa";

type InstallChoice = { outcome: "accepted" | "dismissed" };
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

type NetworkState = "online" | "offline" | "reconnecting";
type PwaContextValue = {
  displayMode: PwaDisplayMode;
  installAvailable: boolean;
  iosInstallAvailable: boolean;
  iosInstructionsOpen: boolean;
  networkState: NetworkState;
  notificationPermission: NotificationPermission | "unsupported";
  pushSupported: boolean;
  serviceWorkerRegistered: boolean;
  updateAvailable: boolean;
  workerVersion: string | null;
  install: () => Promise<void>;
  openIosInstructions: () => void;
  closeIosInstructions: (neverShowAgain?: boolean) => void;
  applyUpdate: () => void;
  dismissUpdate: () => void;
  requestNotificationPermission: () => Promise<void>;
  clearLocalAppData: () => Promise<void>;
};

const PwaContext = createContext<PwaContextValue | null>(null);
const IOS_DISMISSED_KEY = "atlas:pwa:ios-install-dismissed";
const UPDATE_RELOAD_KEY = "atlas:pwa:update-reload";

function emitPwaEvent(name: string) {
  window.dispatchEvent(new CustomEvent("atlas:pwa-event", { detail: { name } }));
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [displayMode, setDisplayMode] = useState<PwaDisplayMode>("unknown");
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [iosInstallAvailable, setIosInstallAvailable] = useState(false);
  const [iosInstructionsOpen, setIosInstructionsOpen] = useState(false);
  const [networkState, setNetworkState] = useState<NetworkState>("online");
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [serviceWorkerRegistered, setServiceWorkerRegistered] = useState(false);
  const [workerVersion, setWorkerVersion] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [pushSupported, setPushSupported] = useState(false);

  useEffect(() => {
    const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
    const standalone = window.matchMedia("(display-mode: standalone)");
    const fullscreen = window.matchMedia("(display-mode: fullscreen)");
    const updateMode = () => {
      const mode = detectPwaDisplayMode({
        standaloneMedia: standalone.matches,
        fullscreenMedia: fullscreen.matches,
        navigatorStandalone: navigatorWithStandalone.standalone === true,
      });
      setDisplayMode(mode);
      document.documentElement.dataset.pwaDisplayMode = mode;
      if (mode !== "browser") emitPwaEvent("pwa_opened_standalone");
      const dismissed = localStorage.getItem(IOS_DISMISSED_KEY) === "1";
      setIosInstallAvailable(canShowIosInstall({
        ios: isIosDevice(navigator),
        safari: isSafariBrowser(navigator.userAgent),
        displayMode: mode,
        dismissed,
      }));
    };
    updateMode();
    standalone.addEventListener("change", updateMode);
    fullscreen.addEventListener("change", updateMode);
    return () => {
      standalone.removeEventListener("change", updateMode);
      fullscreen.removeEventListener("change", updateMode);
    };
  }, []);

  useEffect(() => {
    const initialNetworkTimer = window.setTimeout(
      () => setNetworkState(navigator.onLine ? "online" : "offline"),
      0,
    );
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
    const offline = () => setNetworkState("offline");
    const online = () => {
      setNetworkState("reconnecting");
      recoveryTimer = setTimeout(() => setNetworkState("online"), 3500);
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      window.clearTimeout(initialNetworkTimer);
      if (recoveryTimer) clearTimeout(recoveryTimer);
    };
  }, []);

  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
      emitPwaEvent("pwa_install_prompt_shown");
    };
    const installed = () => {
      setInstallPrompt(null);
      setIosInstallAvailable(false);
      emitPwaEvent("pwa_installed");
    };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    let disposed = false;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "ATLAS_SW_VERSION") setWorkerVersion(String(event.data.version));
    };
    const onControllerChange = () => {
      if (sessionStorage.getItem(UPDATE_RELOAD_KEY) === "1") return;
      sessionStorage.setItem(UPDATE_RELOAD_KEY, "1");
      emitPwaEvent("pwa_updated");
      globalThis.location.reload();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        if (disposed) return;
        setServiceWorkerRegistered(true);
        if (registration.waiting) setWaitingWorker(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              setWaitingWorker(worker);
              emitPwaEvent("pwa_update_available");
            }
          });
        });
        navigator.serviceWorker.controller?.postMessage({ type: "GET_VERSION" });
        await registration.update();
      } catch (error) {
        console.error("[Atlas PWA] Falha ao registrar o service worker.", error);
      }
    };
    const start = () => window.setTimeout(register, 0);
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      disposed = true;
      window.removeEventListener("load", start);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  useEffect(() => {
    const capabilityTimer = window.setTimeout(() => {
      setNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
      setPushSupported("serviceWorker" in navigator && "PushManager" in window);
    }, 0);
    if (sessionStorage.getItem(UPDATE_RELOAD_KEY) === "1") {
      sessionStorage.removeItem(UPDATE_RELOAD_KEY);
    }
    return () => window.clearTimeout(capabilityTimer);
  }, []);

  useEffect(() => {
    const guardOfflineWrite = (event: SubmitEvent) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (navigator.onLine || !form || form.method.toLowerCase() === "get") return;
      event.preventDefault();
      setNetworkState("offline");
      window.dispatchEvent(new CustomEvent("atlas:pwa-action-blocked"));
    };
    const guardOfflineClick = (event: MouseEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-requires-online='true']")
        : null;
      if (navigator.onLine || !target) return;
      event.preventDefault();
      event.stopPropagation();
      setNetworkState("offline");
      window.dispatchEvent(new CustomEvent("atlas:pwa-action-blocked"));
    };
    document.addEventListener("submit", guardOfflineWrite, true);
    document.addEventListener("click", guardOfflineClick, true);
    return () => {
      document.removeEventListener("submit", guardOfflineWrite, true);
      document.removeEventListener("click", guardOfflineClick, true);
    };
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) return;
    emitPwaEvent("pwa_install_started");
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    emitPwaEvent(choice.outcome === "accepted" ? "pwa_installed" : "pwa_install_dismissed");
    setInstallPrompt(null);
  }, [installPrompt]);

  const closeIosInstructions = useCallback((neverShowAgain = false) => {
    setIosInstructionsOpen(false);
    if (neverShowAgain) {
      localStorage.setItem(IOS_DISMISSED_KEY, "1");
      setIosInstallAvailable(false);
      emitPwaEvent("pwa_install_dismissed");
    }
  }, []);

  const applyUpdate = useCallback(() => {
    const protectedFlow = /\/financeiro\/(?:cartoes\/importar-fatura|relatorios)/.test(window.location.pathname) &&
      document.querySelector("form, input[type='file']");
    if (protectedFlow) {
      window.dispatchEvent(new CustomEvent("atlas:pwa-update-blocked"));
      return;
    }
    waitingWorker?.postMessage({ type: "SKIP_WAITING" });
  }, [waitingWorker]);
  const requestNotificationPermission = useCallback(async () => {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  }, []);
  const clearLocalAppData = useCallback(async () => {
    if (!("caches" in window)) return;
    const keys = await caches.keys();
    const atlasKeys = keys.filter((key) => key.startsWith("atlas-pwa-"));
    await Promise.all(atlasKeys.map((key) => caches.delete(key)));
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_STATIC_CACHE" });
    localStorage.removeItem(IOS_DISMISSED_KEY);
  }, []);

  const value = useMemo<PwaContextValue>(() => ({
    displayMode,
    installAvailable: Boolean(installPrompt) && displayMode === "browser",
    iosInstallAvailable,
    iosInstructionsOpen,
    networkState,
    notificationPermission,
    pushSupported,
    serviceWorkerRegistered,
    updateAvailable: Boolean(waitingWorker),
    workerVersion,
    install,
    openIosInstructions: () => setIosInstructionsOpen(true),
    closeIosInstructions,
    applyUpdate,
    dismissUpdate: () => setWaitingWorker(null),
    requestNotificationPermission,
    clearLocalAppData,
  }), [displayMode, installPrompt, iosInstallAvailable, iosInstructionsOpen, networkState, notificationPermission, pushSupported, serviceWorkerRegistered, waitingWorker, workerVersion, install, closeIosInstructions, applyUpdate, requestNotificationPermission, clearLocalAppData]);

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export function usePwa() {
  const value = useContext(PwaContext);
  if (!value) throw new Error("usePwa deve ser usado dentro de PwaProvider.");
  return value;
}
