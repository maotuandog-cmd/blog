export function parseHost(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return (u.hostname || "").toLowerCase();
  } catch {
    return "";
  }
}

export function hostAllowed(host: string, patterns: string[] = []): boolean {
  host = (host || "").toLowerCase().trim();
  if (!host || !patterns.length) return false;
  for (let p of patterns) {
    p = String(p || "").toLowerCase().trim();
    if (!p) continue;
    if (p.startsWith("*.")) {
      const suf = p.slice(2);
      if (host === suf || host.endsWith("." + suf)) return true;
      continue;
    }
    if (host === p) return true;
  }
  return false;
}

export function assertUrlAllowed(rawUrl: string, patterns: string[]): void {
  const u = new URL(rawUrl);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`unsupported scheme: ${u.protocol}`);
  }
  if (!hostAllowed(u.hostname, patterns)) {
    throw new Error(`host not in allowlist: ${u.hostname}`);
  }
}
