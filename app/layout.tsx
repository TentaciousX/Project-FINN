import type { Metadata, Viewport } from "next";
import "@fontsource-variable/roboto-slab";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: "FINN",
  description: "The few filings that matter, and whether management kept its word.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F3EFE4" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
