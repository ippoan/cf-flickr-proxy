import { describe, expect, it, vi } from "vitest";

import type { ImportResponse } from "../bindings/ImportResponse";
import type { OauthUrlResponse } from "../bindings/OauthUrlResponse";
import { corsHeaders, parseAllowedOrigins } from "../src/cors";
import type { Env } from "../src/env";
import { handleRequest } from "../src/proxy";

const FRONT = "https://front.example.com";
const BACKEND = "https://backend.example.com";
const ORG = "00000000-0000-0000-0000-000000000001";

const env: Env = {
  RUST_FLICKR_URL: BACKEND,
  ALLOWED_ORIGINS: `${FRONT}, http://localhost:3000`,
};

/** fetchImpl mock。upstream response を返し、呼び出しを記録する */
function mockFetch(response: () => Response) {
  const fn = vi.fn(async (_input: unknown, _init?: unknown) => response());
  return { fn: fn as unknown as typeof fetch, calls: fn.mock };
}

function upstreamJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", server: "Google Frontend" },
  });
}

describe("parseAllowedOrigins", () => {
  it("splits, trims and drops empty entries", () => {
    expect(parseAllowedOrigins(" https://a.example , ,http://b.example,")).toEqual([
      "https://a.example",
      "http://b.example",
    ]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins("")).toEqual([]);
  });
});

describe("corsHeaders", () => {
  it("echoes back only allowlisted origins", () => {
    const allowed = [FRONT];
    expect(corsHeaders(FRONT, allowed)).toEqual({
      "access-control-allow-origin": FRONT,
      vary: "origin",
    });
    expect(corsHeaders("https://evil.example.com", allowed)).toEqual({});
    expect(corsHeaders(null, allowed)).toEqual({});
  });
});

describe("OPTIONS preflight", () => {
  it("returns CORS headers (incl. x-organization-id) for an allowed origin", async () => {
    const { fn } = mockFetch(() => upstreamJson(200, {}));
    const res = await handleRequest(
      new Request(`https://proxy.example.com/import`, {
        method: "OPTIONS",
        headers: { origin: FRONT },
      }),
      env,
      fn,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(FRONT);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    // x-organization-id が無いと front の org 明示リクエストが preflight で死ぬ
    expect(res.headers.get("access-control-allow-headers")).toBe(
      "content-type, x-organization-id",
    );
    expect(res.headers.get("access-control-max-age")).toBe("86400");
    // preflight は upstream へ到達しない
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns 204 without CORS headers for a non-allowlisted origin", async () => {
    const { fn } = mockFetch(() => upstreamJson(200, {}));
    const res = await handleRequest(
      new Request(`https://proxy.example.com/import`, {
        method: "OPTIONS",
        headers: { origin: "https://evil.example.com" },
      }),
      env,
      fn,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-headers")).toBeNull();
  });
});

describe("route allowlist", () => {
  it("404 for unknown paths", async () => {
    const { fn } = mockFetch(() => upstreamJson(200, {}));
    const res = await handleRequest(
      new Request(`https://proxy.example.com/admin`),
      env,
      fn,
    );
    expect(res.status).toBe(404);
    expect(fn).not.toHaveBeenCalled();
  });

  it("405 with Allow header for a method mismatch", async () => {
    const { fn } = mockFetch(() => upstreamJson(200, {}));
    const res = await handleRequest(
      new Request(`https://proxy.example.com/healthz`, { method: "POST" }),
      env,
      fn,
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, OPTIONS");
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("forwarding", () => {
  it("proxies GET /healthz and passes status/body through", async () => {
    const { fn, calls } = mockFetch(() =>
      upstreamJson(200, { status: "ok", service: "rust-flickr", version: "0.1.0" }),
    );
    const res = await handleRequest(
      new Request(`https://proxy.example.com/healthz`),
      env,
      fn,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { service: string }).service).toBe("rust-flickr");
    expect(calls.calls[0][0]).toBe(`${BACKEND}/healthz`);
  });

  it("passes x-organization-id through on GET /oauth/url", async () => {
    const body: OauthUrlResponse = {
      authorization_url: "https://www.flickr.com/services/oauth/authorize?oauth_token=rt",
      request_token: "rt",
      request_token_secret: "rts",
    };
    const { fn, calls } = mockFetch(() => upstreamJson(200, body));
    const res = await handleRequest(
      new Request(`https://proxy.example.com/oauth/url`, {
        headers: { "x-organization-id": ORG, origin: FRONT },
      }),
      env,
      fn,
    );
    expect(res.status).toBe(200);
    const init = calls.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("x-organization-id")).toBe(ORG);
    // 許可 origin への実レスポンスにも CORS ヘッダが付く
    expect(res.headers.get("access-control-allow-origin")).toBe(FRONT);
  });

  it("does NOT inject a default org when the client omits the header", async () => {
    const { fn, calls } = mockFetch(() =>
      upstreamJson(400, { error: "bad_request", message: "missing required header" }),
    );
    const res = await handleRequest(
      new Request(`https://proxy.example.com/oauth/url`),
      env,
      fn,
    );
    const init = calls.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("x-organization-id")).toBeNull();
    // backend の 400 をそのまま透過する
    expect(res.status).toBe(400);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("forwards POST body and passes 412 through untouched (no silent 200)", async () => {
    const { fn, calls } = mockFetch(() =>
      upstreamJson(412, { error: "no_token", message: "flickr token not registered" }),
    );
    const res = await handleRequest(
      new Request(`https://proxy.example.com/import`, {
        method: "POST",
        headers: {
          "x-organization-id": ORG,
          "content-type": "application/json",
        },
        body: JSON.stringify({ limit: 500 }),
      }),
      env,
      fn,
    );
    expect(res.status).toBe(412);
    expect(((await res.json()) as { error: string }).error).toBe("no_token");
    const init = calls.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"limit":500}');
  });

  it("proxies POST /oauth/callback responses", async () => {
    const { fn, calls } = mockFetch(() =>
      upstreamJson(200, { user_nsid: "u", username: "n", saved: true }),
    );
    const res = await handleRequest(
      new Request(`https://proxy.example.com/oauth/callback`, {
        method: "POST",
        headers: {
          "x-organization-id": ORG,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          oauth_token: "rt",
          oauth_verifier: "v",
          request_token_secret: "rts",
        }),
      }),
      env,
      fn,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { saved: boolean }).saved).toBe(true);
    expect(calls.calls[0][0]).toBe(`${BACKEND}/oauth/callback`);
  });

  it("passes typed ImportResponse bodies through", async () => {
    const body: ImportResponse = {
      imported_count: 2,
      errors_count: 0,
      remaining_count: 0,
      photos: [
        { id: "1", secret: "s1", server: "sv1" },
        { id: "2", secret: "s2", server: "sv2" },
      ],
    };
    const { fn } = mockFetch(() => upstreamJson(200, body));
    const res = await handleRequest(
      new Request(`https://proxy.example.com/import`, {
        method: "POST",
        headers: { "x-organization-id": ORG },
      }),
      env,
      fn,
    );
    expect(((await res.json()) as ImportResponse).imported_count).toBe(2);
  });

  it("does not leak non-allowlisted request headers (cookie etc.) upstream", async () => {
    const { fn, calls } = mockFetch(() => upstreamJson(200, {}));
    await handleRequest(
      new Request(`https://proxy.example.com/healthz`, {
        headers: { cookie: "session=secret", authorization: "Bearer tok" },
      }),
      env,
      fn,
    );
    const init = calls.calls[0][1] as RequestInit;
    const sent = new Headers(init.headers);
    expect(sent.get("cookie")).toBeNull();
    expect(sent.get("authorization")).toBeNull();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("strips upstream infra headers but keeps content-type", async () => {
    const { fn } = mockFetch(() => upstreamJson(200, {}));
    const res = await handleRequest(
      new Request(`https://proxy.example.com/healthz`),
      env,
      fn,
    );
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("server")).toBeNull();
  });

  it("normalizes a trailing slash in RUST_FLICKR_URL and keeps the query string", async () => {
    const { fn, calls } = mockFetch(() => upstreamJson(200, {}));
    await handleRequest(
      new Request(`https://proxy.example.com/oauth/url?probe=1`, {
        headers: { "x-organization-id": ORG },
      }),
      { ...env, RUST_FLICKR_URL: `${BACKEND}/` },
      fn,
    );
    expect(calls.calls[0][0]).toBe(`${BACKEND}/oauth/url?probe=1`);
  });

  it("returns 502 with a fixed message when the upstream is unreachable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fn = vi.fn(async () => {
      throw new TypeError("fetch failed: connection refused to 10.0.0.1");
    }) as unknown as typeof fetch;
    const res = await handleRequest(
      new Request(`https://proxy.example.com/healthz`, {
        headers: { origin: FRONT },
      }),
      env,
      fn,
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; message: string };
    expect(body).toEqual({ error: "bad_gateway", message: "upstream unreachable" });
    // upstream エラー詳細は response に echo しない (log のみ)
    expect(JSON.stringify(body)).not.toContain("10.0.0.1");
    expect(consoleError).toHaveBeenCalled();
    // エラー応答にも CORS ヘッダは付く (front がエラーを読めるように)
    expect(res.headers.get("access-control-allow-origin")).toBe(FRONT);
    consoleError.mockRestore();
  });

  it("omits CORS headers when ALLOWED_ORIGINS is unset", async () => {
    const { fn } = mockFetch(() => upstreamJson(200, {}));
    const res = await handleRequest(
      new Request(`https://proxy.example.com/healthz`, {
        headers: { origin: FRONT },
      }),
      { RUST_FLICKR_URL: BACKEND },
      fn,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
