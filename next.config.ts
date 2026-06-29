import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for a small Docker image.
  output: "standalone",
  // Load these from node_modules at runtime instead of bundling, so their
  // data/font files (pdfkit .afm fonts, exceljs) resolve correctly.
  serverExternalPackages: ["pdfkit", "exceljs"],
};

export default nextConfig;
