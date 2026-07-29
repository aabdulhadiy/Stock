import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for a small Docker image (§16).
  output: "standalone",

  // Load these from node_modules at runtime instead of bundling, so their
  // data/font files (pdfkit .afm metrics, exceljs) resolve correctly.
  serverExternalPackages: ["pdfkit", "exceljs"],

  // The PDF writer reads DejaVu Sans from disk at runtime — a path the bundler
  // cannot follow. Tracing it explicitly guarantees the fonts reach the
  // standalone output; without them, Russian and Uzbek PDF exports would fall
  // back to Helvetica and render Cyrillic as blanks (§13).
  outputFileTracingIncludes: {
    "/**": ["./assets/fonts/**"],
  },
};

export default nextConfig;
