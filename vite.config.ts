import { defineConfig } from "vite";
import { gymSavePlugin } from "./vite/gym-save-plugin";

export default defineConfig({
  // ponytail: default root/public are fine; only test config is non-default.
  // gymSavePlugin is dev-server-only (apply:"serve") — the /__gym/save write-back never ships.
  plugins: [gymSavePlugin()],
  test: {
    globals: true,
    environment: "node", // sim core is pure — no DOM needed
    include: ["src/**/*.test.ts"],
  },
});
