// src/app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { SettingsProvider } from "@/lib/settings/provider";

export const metadata: Metadata = {
  title: "CryptoPi • Dynamics",
  description: "Dynamics / matrices / aux",
};

export const viewport: Viewport = {
  themeColor: "#10b981", // emerald
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-screen">
        <SettingsProvider>{children}</SettingsProvider>
      </body>
    </html>
  );
}
