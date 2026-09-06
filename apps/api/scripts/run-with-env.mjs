// Loads the repo-root .env (or apps/api/.env if present) into process.env
// and execs the given command. Keeps npm scripts cross-platform.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [path.join(apiRoot, ".env"), path.resolve(apiRoot, "../../.env")];
const envPath = candidates.find((p) => fs.existsSync(p));

if (envPath) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: node run-with-env.mjs <command> [args...]");
  process.exit(1);
}

const result = spawnSync(cmd, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});
process.exit(result.status ?? 1);
