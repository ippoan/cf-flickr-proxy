/** cf-flickr-proxy の Worker bindings (wrangler.jsonc の vars)。 */
export interface Env {
  /** proxy 先 rust-flickr (Cloud Run) の base URL。末尾スラッシュは有無どちらでも可 */
  RUST_FLICKR_URL: string;
  /**
   * CORS を許可する origin の comma 区切りリスト (例:
   * "https://front.example.com,http://localhost:3000")。
   * 空 / 未設定なら CORS ヘッダを一切付けない (= ブラウザ以外の
   * クライアントには影響しない)。
   */
  ALLOWED_ORIGINS?: string;
}
