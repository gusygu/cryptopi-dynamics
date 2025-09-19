import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const LINE_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;
let loaded = false;

export function loadEnv(paths = [".env.local", ".env"]) {
  if (loaded) return;
  loaded = true;
  for (const rel of paths) {
    const full = resolve(process.cwd(), rel);
    if (!existsSync(full)) continue;
    let text = "";
    try { text = readFileSync(full, "utf8"); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = LINE_RE.exec(trimmed);
      if (!match) continue;
      const key = match[1];
      if (process.env[key] != null) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      value = value.replace(/\\n/g, "\n");
      process.env[key] = value;
    }
  }
}