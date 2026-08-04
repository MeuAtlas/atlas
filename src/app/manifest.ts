import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Atlas",
    short_name: "Atlas",
    description: "Seu espaço pessoal para organizar finanças, agenda, tarefas, documentos e decisões.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#07111f",
    theme_color: "#07111f",
    lang: "pt-BR",
    categories: ["finance", "productivity", "lifestyle"],
    icons: [
      {
        src: "/icons/atlas-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/atlas-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/atlas-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/atlas-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
