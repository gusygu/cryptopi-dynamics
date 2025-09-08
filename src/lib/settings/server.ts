// src/lib/settings/server.ts
import { cookies } from "next/headers";
import { AppSettings, DEFAULT_SETTINGS, migrateSettings } from "./schema";

export async function getSettingsServer(): Promise<AppSettings> {
  try {
    const jar = await cookies();                       // ⬅️ await
    const raw = jar.get("appSettings")?.value;
    if (!raw) return DEFAULT_SETTINGS;
    return migrateSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}
