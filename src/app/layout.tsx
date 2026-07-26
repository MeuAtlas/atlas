import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";

import "./globals.css";

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
  description: "Seu espaço pessoal, privado e seguro.",
  manifest: "/manifest.webmanifest",
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
        url: "/icons/atlas-app-icon-light.png",
        type: "image/png",
        sizes: "1024x1024",
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

const themeScript = `
  (() => {
    try {
      const storedTheme = localStorage.getItem('atlas-theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme =
        storedTheme === 'dark' || storedTheme === 'light'
          ? storedTheme
          : prefersDark
            ? 'dark'
            : 'light';

      const root = document.documentElement;
      root.setAttribute('data-theme', theme);
      root.classList.toggle('dark', theme === 'dark');
      root.style.colorScheme = theme;
    } catch {}
  })();
`;

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
      <head>
        <Script
          id="atlas-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body className="min-h-full">
        {children}
      </body>
    </html>
  );
}
