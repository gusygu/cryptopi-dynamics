// src/app/layout.tsx
import "./globals.css";
import { SettingsProvider } from "@/lib/settings/provider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SettingsProvider>{children}</SettingsProvider>
      </body>
    </html>
  );
}
