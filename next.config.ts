import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.17"],
  serverExternalPackages: ["pdfjs-dist"],
  images: {
    qualities: [75, 90],
  },
};

export default nextConfig;
