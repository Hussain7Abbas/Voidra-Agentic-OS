import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: [
        "src/domain/**/*.ts",
        "src/service/workspaces.ts",
        "src/service/instructions.ts",
        "src/service/knowledge.ts",
        "src/service/handoffs.ts",
        "src/service/openrouter.ts",
        "src/service/agents.ts",
        "src/service/notes.ts",
        "src/shared/sequenced-events.ts",
        "src/shared/service-lifecycle.ts",
      ],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
      reporter: ["text", "html"],
    },
  },
});
