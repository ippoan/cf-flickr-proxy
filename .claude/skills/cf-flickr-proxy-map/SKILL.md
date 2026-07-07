---
name: cf-flickr-proxy-map
generated-from: cf-flickr-proxy:645cea55af8ebaceed9dea29d0a7507b1e7fe152
paths: [src/, bindings/]
description: ippoan/cf-flickr-proxy (rust-flickr を front に公開する REST proxy / CORS edge Worker) の構造ナビゲーション。route allowlist (health/oauth/import/sync)・ヘッダ allowlist・org 非注入・Smart Placement・single-env 運用と edge 100s 制限を 1 枚にまとめる。トリガー:「cf-flickr-proxy」「flickr-proxy.mtamaramu.com」「flickr proxy route」「proxy 404 flickr」「org 注入」等。
---

# cf-flickr-proxy-map — ippoan/cf-flickr-proxy 構造ナビゲーション

rust-flickr (Cloud Run) を front に公開する**依存ゼロ**の素 fetch handler Worker。
公開 URL: https://flickr-proxy.mtamaramu.com (custom domain、workers.dev off)。

> ここは索引 (pointer)。細部は repo 側が正。

## 構成

| path | 役割 |
|---|---|
| `src/proxy.ts` | ROUTES allowlist (path→method、404/405) + FORWARD_HEADERS (`x-organization-id`/`content-type` のみ) + status 透過 forward |
| `src/cors.ts` | ALLOWED_ORIGINS echo-back + preflight |
| `src/index.ts` | fetch エントリ |
| `bindings/` | rust-flickr ts-rs 型のコピー (Rust が SoT、編集禁止) |

## 設計の不変条件 (変更 PR で崩さない)

- **org をデフォルト注入しない** — 旧実装の暗黙 org フォールバック事故 (rust-flickr#1) の根治
- **status 透過** (412/424/500 を 200 に丸めない)、upstream エラー詳細は 502 固定文言 + log のみ
- **Smart Placement** (`placement.mode=smart`) — 宛先 asia-northeast1 への fetch を近地化 (run.app GFE 配布ムラ対策の保険も兼ねる)
- single-env (staging = prod)、secret binding ゼロ (`secrets.required: []` 明示)
- **edge ~100s 制限** — 長時間の /sync は Cloud Scheduler → Cloud Run 直 (proxy 非経由) が正

## CLAUDE.md から移設 (2026-07-07)

## まず読むもの

- [`README.md`](./README.md) — route 一覧 / 設計上の要点 / vars / デプロイ
- [Issue #1](https://github.com/ippoan/cf-flickr-proxy/issues/1) — 実装の経緯と
  cutover checklist (rust-flickr#1 PR6 の引継ぎ)

## 構成

| path | 役割 |
|---|---|
| `src/index.ts` | Worker エントリ (fetch handler) |
| `src/proxy.ts` | route allowlist + ヘッダ allowlist + status 透過 forward |
| `src/cors.ts` | `ALLOWED_ORIGINS` echo-back CORS + preflight |
| `src/env.ts` | vars の型 |
| `bindings/` | rust-flickr の ts-rs 生成型のコピー (Rust が SoT、編集禁止) |

## 設計上の要点 (触る前に)

- **org をデフォルト注入しない** — `x-organization-id` は純粋 pass-through。
  Worker 側で fallback org を足すコードを書かない (rust-flickr#1 の 0 件取り込み
  事故の根治がこの設計の動機)。
- **status は透過** — 412/424/500 を 200 に丸めない (「黙って 200」禁止)。
- **upstream エラー詳細を response に echo しない** — 502 固定文言、詳細は log のみ。
- **forward するヘッダは allowlist 式** (`x-organization-id` / `content-type` のみ)。
  追加する時は値漏れ (cookie / authorization) に注意。
- **依存ゼロを保つ** — proxy は素の fetch handler で足りる。framework や
  ライブラリを足す前に本当に必要か考える。
