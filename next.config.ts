import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Eliminăm toate configurațiile pentru pdfjs-dist - lăsăm Next.js să-l proceseze normal
  // Pe VPS/monorepo: root explicit ca Next să folosească node_modules din betonbot-web
  turbopack: { root: process.cwd() },
};

export default nextConfig;
