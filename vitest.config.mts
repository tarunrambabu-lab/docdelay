// Settings for the automated tests (run them with: npm test).
// Test files live next to the code they test and end in ".test.ts".
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Let tests use the same "@/..." imports as the app (see tsconfig.json).
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
  },
});
