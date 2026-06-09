// CORS は「許可 origin の echo-back」方式。`*` は使わない —
// front は x-organization-id ヘッダ付きでリクエストするため、
// 許可 origin を ALLOWED_ORIGINS (vars) で明示する。

/** comma 区切りの ALLOWED_ORIGINS を正規化 (trim + 空要素除去) */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Origin が許可リストにあれば CORS ヘッダ (origin echo-back + Vary) を返す */
export function corsHeaders(
  origin: string | null,
  allowed: string[],
): Record<string, string> {
  if (origin === null || !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    vary: "origin",
  };
}

/**
 * OPTIONS preflight 応答。許可 origin には allow-methods / allow-headers を
 * 返し、それ以外には CORS ヘッダ無しの 204 だけ返す (ブラウザ側で block される)。
 */
export function preflightResponse(
  origin: string | null,
  allowed: string[],
): Response {
  const headers = new Headers(corsHeaders(origin, allowed));
  if (headers.has("access-control-allow-origin")) {
    headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
    // x-organization-id を漏らすと front からの org 明示リクエストが preflight で死ぬ
    // (Refs ippoan/cf-flickr-proxy#1)
    headers.set("access-control-allow-headers", "content-type, x-organization-id");
    headers.set("access-control-max-age", "86400");
  }
  return new Response(null, { status: 204, headers });
}
