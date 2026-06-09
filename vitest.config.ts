import { defineConfig } from "vitest/config";

// proxy は Workers 固有 binding (KV/DO/R2) を一切使わないので、
// vitest-pool-workers ではなく素の node 環境でテストする
// (Request/Response/Headers は Node 18+ の web standard グローバル)。
export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary"],
    },
  },
});
