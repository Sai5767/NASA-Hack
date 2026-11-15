import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** The commit this folder is at when the server (or the build) starts. Shown in the footer so you can tell what you are running. */
function gitVersion() {
  const run = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  try {
    return { version: run("git rev-parse --short HEAD") || "unknown", dirty: Boolean(run("git status --porcelain --untracked-files=no")) };
  } catch {
    return { version: process.env.TD_VERSION || "unknown", dirty: false };
  }
}

const { version, dirty } = gitVersion();

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: "127.0.0.1" },
  define: { __APP_VERSION__: JSON.stringify(version), __APP_DIRTY__: JSON.stringify(dirty) },
});
