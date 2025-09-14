export type PreviewSource = "local" | "exchangeInfo" | "ticker" | "empty" | "error";

export async function getPreviewSymbols(
  coins: string[],
  _settings?: any
): Promise<{ symbols: string[]; source: PreviewSource }> {
  try {
    const r = await fetch("/api/preview/symbols", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coins: coins?.map(s => String(s).toUpperCase()) }),
      cache: "no-store",
    });
    if (!r.ok) return { symbols: [], source: "error" };
    const j = await r.json();
    const syms: string[] = Array.isArray(j?.symbols) ? j.symbols.map((s: any) => String(s).toUpperCase()) : [];
    const src: PreviewSource = (j?.source ?? "empty") as PreviewSource;
    return { symbols: syms, source: src };
  } catch {
    return { symbols: [], source: "error" };
  }
}
