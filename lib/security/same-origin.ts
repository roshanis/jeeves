/** A browser cannot forge Host or X-Forwarded-Host, so an Origin whose host matches either is the page's own origin (req.url is Next's bind address, not the public one). */
export function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin === new URL(req.url).origin) return true;
  const hosts = [req.headers.get("host"), req.headers.get("x-forwarded-host")?.split(",")[0]?.trim()];
  return hosts.some((h) => !!h && h.toLowerCase() === parsed.host.toLowerCase());
}
