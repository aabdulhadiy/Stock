import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Toy Inventory & Sales",
  description: "Inventory and sales management across warehouse and shops",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
