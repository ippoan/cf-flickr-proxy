# cf-flickr-proxy

[ippoan/rust-flickr](https://github.com/ippoan/rust-flickr) (Cloud Run, axum REST) を
front に公開するための **REST proxy / CORS** edge Worker。

```
[ front (nuxt) ]──REST──▶ [ cf-flickr-proxy (CF Worker) ] ──fetch──▶ [ rust-flickr (Cloud Run) ]
[ Cloud Scheduler ]──────────────(Worker を経由せず直接)───────────▶ 同上 /import
```

設計の親 issue: [ippoan/cf-flickr-proxy#1](https://github.com/ippoan/cf-flickr-proxy/issues/1)
/ [ippoan/rust-flickr#1](https://github.com/ippoan/rust-flickr/issues/1)

## proxy する route

| method | path | backend の挙動 |
|---|---|---|
| `GET` | `/health` | version 付き health check。**外形監視はこちら** |
| `GET` | `/healthz` | `/health` と同一 handler。**run.app / ghs の Google フロントが `/healthz` を外部からインターセプトして汎用 404 を返す**ため、proxy 経由でも upstream に届かない (罠。Refs #1) |
| `GET` | `/oauth/url` | Flickr OAuth1.0a 認可 URL 発行 (要 `x-organization-id`) |
| `POST` | `/oauth/callback` | verifier → access token 交換 + 保存 (要 `x-organization-id`) |
| `POST` | `/import` | 未検証 `cam_files.flickr_id` の検証 + 登録 (要 `x-organization-id`) |
| `POST` | `/sync` | カメラ SD 巡回 → `cam_files` UPSERT → Flickr アップロード (要 `x-organization-id`)。**edge は ~100s で切られる**ため手動実行時は `{"upload_limit":小さめ}` を渡す。定期実行は Cloud Scheduler → Cloud Run 直 (proxy 非経由) |

上記以外の path は 404、method 違いは 405。Worker から backend へは
`x-organization-id` / `content-type` ヘッダ**だけ**を pass-through する
(cookie 等は流さない)。

## 設計上の要点

- **org はデフォルト注入しない** — `x-organization-id` は client が明示で送り、
  Worker はそのまま透過する。欠落 / 非 UUID の検証は rust-flickr 側 (400)。
  旧実装の「ヘッダ欠落時に固定 org へ黙ってフォールバック → RLS で token が
  見えず 0 件取り込み」事故 (rust-flickr#1) の再発防止。
- **status pass-through** — rust-flickr は 400/412/424/500/503 を明示的に返す
  (「黙って 200」禁止)。Worker は status を**そのまま**透過する (200 に丸めない)。
  代表例: `412` = Flickr token 未登録 (要 `/oauth` フロー)、`424` = Flickr API
  上流エラー。
- **upstream エラーの詳細を echo しない** — backend 到達不能時は固定文言の 502。
  詳細は Worker log のみ。
- **CORS は許可 origin の echo-back** — `ALLOWED_ORIGINS` (vars, comma 区切り)
  に一致した Origin にだけ `Access-Control-Allow-Origin` を返す。`*` は使わない。
  preflight の `Access-Control-Allow-Headers` に `x-organization-id` を含む。

## Vars (`wrangler.jsonc`)

| var | 用途 |
|---|---|
| `RUST_FLICKR_URL` | proxy 先 rust-flickr の base URL (staging = 実運用) |
| `ALLOWED_ORIGINS` | CORS 許可 origin (comma 区切り)。front の origin が決まったら追記 |

secret binding は無し (rust-flickr 側が Secret Manager で完結)。

## 型 (`bindings/`)

`bindings/*.ts` は rust-flickr の ts-rs 生成型のコピー
(ippoan/rust-flickr@`5920f6d94ee50adde7e0567f32381322eaf63bc3` 時点)。
Rust struct が SoT — rust-flickr 側で型が変わったら再コピーする。
front から叩く場合は rust-flickr の
[`clients/ts/client.ts`](https://github.com/ippoan/rust-flickr/blob/main/clients/ts/client.ts)
(typed fetch ラッパ) に `baseUrl: "https://flickr-proxy.mtamaramu.com"` を渡せばよい。

## 開発

```sh
npm install
npm run typecheck
npm test
npm run dev        # ローカル起動 (wrangler dev)
```

## デプロイ

公開 URL: **https://flickr-proxy.mtamaramu.com** (custom domain、workers.dev は off)

CI (`.github/workflows/test.yml` → ippoan/ci-workflows `frontend-ci.yml`) が
single-env 運用で deploy する:

- PR merge (main push) → `npx wrangler deploy`
- `v*` tag push → release deploy (default は no-traffic version upload)

手動 fallback: `npm run deploy`
