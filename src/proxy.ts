// rust-flickr (Cloud Run) への透過 REST proxy。
//
// 設計 (Refs ippoan/cf-flickr-proxy#1, ippoan/rust-flickr#1):
// - x-organization-id は client から明示で受けて **pass-through** する。
//   Worker 側でデフォルト org を注入しない (旧実装のヘッダ欠落時
//   固定 org フォールバックが RLS で token を隠し 0 件取り込みが
//   続いた事故の根治)。検証も rust-flickr 側に任せる (欠落/非 UUID は
//   backend が 400 を返す)。
// - upstream の status をそのまま透過する。412 (token 未登録) /
//   424 (Flickr 上流エラー) / 500 を 200 に丸めない (「黙って 200」禁止)。

import { corsHeaders, parseAllowedOrigins, preflightResponse } from "./cors";
import type { Env } from "./env";

/** proxy を許可する route。それ以外の path は 404、method 違いは 405 */
const ROUTES: Record<string, "GET" | "POST"> = {
  // 外形監視は /health を使う。/healthz は run.app / ghs の Google フロントが
  // インターセプトして汎用 404 を返すため、proxy 経由でも upstream の応答が
  // 得られない (Refs #1 cutover 検証、rust-flickr#8 で /health alias 追加)
  "/health": "GET",
  "/healthz": "GET",
  "/oauth/url": "GET",
  "/oauth/callback": "POST",
  "/import": "POST",
  // カメラ SD 巡回 + Flickr upload (rust-flickr#9)。edge は 100s で切られるため
  // 手動でここ経由で叩く時は upload_limit を小さく渡す (定期実行は
  // Cloud Scheduler → Cloud Run 直 = proxy 非経由)
  "/sync": "POST",
};

/** upstream へ pass-through する request ヘッダ (allowlist 式 — cookie 等は流さない) */
const FORWARD_HEADERS = ["x-organization-id", "content-type"] as const;

function json(
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}

export async function handleRequest(
  request: Request,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return preflightResponse(origin, allowed);
  }

  const cors = corsHeaders(origin, allowed);

  const allowedMethod = ROUTES[url.pathname];
  if (allowedMethod === undefined) {
    return json(
      404,
      { error: "not_found", message: `no such route: ${url.pathname}` },
      cors,
    );
  }
  if (request.method !== allowedMethod) {
    return json(
      405,
      {
        error: "method_not_allowed",
        message: `${url.pathname} accepts ${allowedMethod} only`,
      },
      { ...cors, allow: `${allowedMethod}, OPTIONS` },
    );
  }

  const headers = new Headers();
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  // body は読み切って forward (対象 route の body は小さい JSON のみ)
  const body =
    allowedMethod === "GET" ? undefined : await request.arrayBuffer();

  const base = env.RUST_FLICKR_URL.replace(/\/$/, "");
  const target = `${base}${url.pathname}${url.search}`;

  let upstream: Response;
  try {
    upstream = await fetchImpl(target, {
      method: request.method,
      headers,
      body,
    });
  } catch (e: unknown) {
    // 詳細は log のみに出す (response body は固定文言 — 値漏れ防止)
    console.error("rust-flickr upstream fetch failed:", e);
    return json(
      502,
      { error: "bad_gateway", message: "upstream unreachable" },
      cors,
    );
  }

  // status / body は透過。response ヘッダは content-type + CORS に絞る
  // (Cloud Run のインフラヘッダを front に流さない)。
  const responseHeaders = new Headers(cors);
  const contentType = upstream.headers.get("content-type");
  if (contentType !== null) {
    responseHeaders.set("content-type", contentType);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
