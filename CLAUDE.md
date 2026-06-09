# CLAUDE.md

ippoan/rust-flickr (Cloud Run) を front に公開する REST proxy / CORS edge Worker。

このリポジトリで Claude Code セッションを動かす時の作業ガイド。共通項は
[ippoan/claude-md](https://github.com/ippoan/claude-md) の `CLAUDE.md.template` に従う。

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

## ビルド / テスト

PR を出す前に手元で green に:

```sh
npm install
npm run typecheck
npm test
```

CI (`.github/workflows/test.yml`) は `main` への PR ごとに ci-workflows の
`frontend-ci.yml` (project_type: worker、single-env = staging = prod) で同じことを
回し、merge / tag で `wrangler deploy` する。

## GitHub 自動化 (重要)

- **`main` に直 push しない。** PR を作る (bootstrap commit 済みなので以後は全て PR)。
- PR / commit は `Refs #N` を使う (`Closes/Fixes/Resolves` は禁止 — auto-close 防止)。
- `mcp__github__enable_pr_auto_merge` を reflex で呼ばない (user 明示指示時のみ)。
- PR 作成後は同じ turn で `mcp__github__subscribe_pr_activity` を呼び CI を watch する。

---

_共通項を直すときは [`ippoan/claude-md`](https://github.com/ippoan/claude-md) の
`CLAUDE.md.template` を更新すること。_
