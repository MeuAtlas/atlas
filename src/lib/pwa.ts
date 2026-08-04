export type PwaDisplayMode = "browser" | "standalone" | "fullscreen" | "unknown";

export function detectPwaDisplayMode(input: {
  standaloneMedia?: boolean;
  fullscreenMedia?: boolean;
  navigatorStandalone?: boolean;
}): PwaDisplayMode {
  if (input.fullscreenMedia) return "fullscreen";
  if (input.standaloneMedia || input.navigatorStandalone) return "standalone";
  return "browser";
}

export function isIosDevice(input: {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}) {
  const userAgent = input.userAgent ?? "";
  const platform = input.platform ?? "";
  return /iPad|iPhone|iPod/i.test(userAgent) ||
    (/Mac/i.test(platform) && (input.maxTouchPoints ?? 0) > 1);
}

export function isSafariBrowser(userAgent: string) {
  return /Safari/i.test(userAgent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium|Android/i.test(userAgent);
}

export function canShowIosInstall(input: {
  ios: boolean;
  safari: boolean;
  displayMode: PwaDisplayMode;
  dismissed: boolean;
}) {
  return input.ios && input.safari && input.displayMode === "browser" && !input.dismissed;
}

export function isSensitiveCacheUrl(value: string, origin = "https://atlas.local") {
  const url = new URL(value, origin);
  return url.origin !== origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/financeiro") ||
    url.pathname.startsWith("/settings") ||
    url.pathname.startsWith("/admin") ||
    /(?:supabase|pluggy)/i.test(url.hostname) ||
    /\.(?:pdf|docx?|xlsx?)$/i.test(url.pathname);
}
