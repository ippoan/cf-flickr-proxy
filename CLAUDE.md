# CLAUDE.md

ippoan/rust-flickr (Cloud Run) を front に公開する REST proxy / CORS edge Worker。

詳細 (アーキテクチャ・経緯・gotcha) は cf-flickr-proxy-map skill を参照。

## ビルド / テスト

```sh
npm install
npm run typecheck
npm test
```

CI: `.github/workflows/test.yml` → ci-workflows `frontend-ci.yml` (single-env = staging = prod)、merge / tag で `wrangler deploy`。

## 設計の hard constraint (変更 PR で崩さない)

- **org をデフォルト注入しない** — `x-organization-id` は純粋 pass-through。Worker 側で fallback org を足すコードを書かない。
- **status は透過** — 412/424/500 を 200 に丸めない (「黙って 200」禁止)。
- **upstream エラー詳細を response に echo しない** — 502 固定文言、詳細は log のみ。
- **forward するヘッダは allowlist 式** (`x-organization-id` / `content-type` のみ)。追加時は値漏れ (cookie / authorization) に注意。
- **依存ゼロを保つ** — proxy は素の fetch handler で足りる。framework やライブラリを足す前に本当に必要か考える。
- **`bindings/` は編集禁止** — rust-flickr ts-rs 生成型のコピー (Rust が SoT)。

## GitHub 自動化 (重要)

- **`main` に直 push しない。** PR を作る (bootstrap commit 済みなので以後は全て PR)。
- PR / commit は `Refs #N` を使う (`Closes/Fixes/Resolves` は禁止 — auto-close 防止)。
- `mcp__github__enable_pr_auto_merge` を reflex で呼ばない (user 明示指示時のみ)。
- PR 作成後は同じ turn で `mcp__github__subscribe_pr_activity` を呼び CI を watch する。

---

_共通項を直すときは [`ippoan/claude-md`](https://github.com/ippoan/claude-md) の
`CLAUDE.md.template` を更新すること。_
