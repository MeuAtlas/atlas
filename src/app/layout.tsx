import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { ThemeInitializer } from "@/components/atlas/theme-toggle";
import { NavigationFeedbackProvider } from "@/components/navigation/navigation-feedback";
import { PwaRuntime } from "@/components/pwa/pwa-runtime";

import "./globals.css";

const themeBootstrap = `(function(){try{var stored=localStorage.getItem('atlas-theme');var theme=stored==='dark'||stored==='light'?stored:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var root=document.documentElement;root.dataset.theme=theme;root.classList.toggle('dark',theme==='dark');root.style.colorScheme=theme;}catch(_){}})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "Atlas",
  title: "Atlas",
  description: "Seu espaço pessoal para organizar finanças, agenda, tarefas, documentos e decisões.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Atlas",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      {
        url: "/icons/atlas-app-icon-light.png",
        type: "image/png",
        sizes: "1024x1024",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icons/atlas-app-icon-dark.png",
        type: "image/png",
        sizes: "1024x1024",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    apple: [
      {
        url: "/icons/atlas-apple-touch-icon.png",
        type: "image/png",
        sizes: "180x180",
      },
    ],
  },
  formatDetection: {
    telephone: false,
    date: false,
    email: false,
    address: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#dcecff" },
    { media: "(prefers-color-scheme: dark)", color: "#07111f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Script id="atlas-theme-bootstrap" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <ThemeInitializer />
        <PwaRuntime>
          <NavigationFeedbackProvider>{children}</NavigationFeedbackProvider>
        </PwaRuntime>
      </body>
    </html>
  );
}
