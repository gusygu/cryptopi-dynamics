// src/lab/aux-str/lib/layoutHash.ts
// Safe hash for Node (crypto) and Edge (WebCrypto)
export async function layoutHash(input: unknown) {
  const s = JSON.stringify(input ?? {});
  // Node path
  try {
    const nodeCrypto = await import("crypto");
    return nodeCrypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
  } catch {
    // Edge/WebCrypto path
    const enc = new TextEncoder().encode(s);
    const buf = await crypto.subtle.digest("SHA-1", enc);
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    return hex.slice(0, 12);
  }
}
