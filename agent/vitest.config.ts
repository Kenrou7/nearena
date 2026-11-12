import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80
      },
      include: ["src/**/*.ts"],
      // Thin adapters over the network (NEAR RPC, NEAR AI) and the CLI entrypoint.
      exclude: ["src/index.ts", "src/near-client.ts", "src/near-ai-llm.ts"]
    }
  }
});
