import { access, copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.join(root, "bundle");
const frontend = path.join(root, "frontend");
const publish = process.argv.includes("--push");

function run(command, args, cwd, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.status;
}

function runNpm(args, cwd) {
  const windows = process.platform === "win32";
  const result = windows
    ? spawnSync(`npm.cmd ${args.join(" ")}`, { cwd, encoding: "utf8", stdio: "inherit", shell: true })
    : spawnSync("npm", args, { cwd, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function hasStagedChanges(cwd) {
  const status = run("git", ["diff", "--cached", "--quiet"], cwd, { allowFailure: true });
  if (status === 0) return false;
  if (status === 1) return true;
  throw new Error(`Could not inspect staged changes in ${cwd}`);
}

function commitStagedChanges(cwd, message) {
  if (!hasStagedChanges(cwd)) return false;
  run("git", [
    "commit",
    "-m",
    message,
    "-m",
    "Co-authored-by: OpenBot <335604065+openbotgit[bot]@users.noreply.github.com>",
  ], cwd);
  return true;
}

run("git", ["submodule", "update", "--init", "--remote", "backend", "frontend", "cli"], root);
runNpm(["ci"], frontend);
runNpm(["audit", "--audit-level=high"], frontend);
runNpm(["run", "build"], frontend);

const index = path.join(frontend, "dist", "snip-frontend", "browser", "index.html");
try {
  await access(index);
} catch {
  throw new Error(`Angular build output is missing: ${index}`);
}

await mkdir(bundle, { recursive: true });
const publicDir = path.join(bundle, "public");
await rm(publicDir, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });
await copyFile(path.join(root, "backend", "server.js"), path.join(bundle, "server.js"));
await copyFile(path.join(root, "cli", "cli.js"), path.join(bundle, "cli.js"));
await cp(path.join(frontend, "dist", "snip-frontend", "browser"), publicDir, { recursive: true });
await writeFile(path.join(bundle, ".env"), "PUBLIC_DIR=./public\n");
await writeFile(
  path.join(bundle, "package.json"),
  `${JSON.stringify({ name: "snip-bundle", private: true, scripts: { start: "bun server.js" } }, null, 2)}\n`,
);
await writeFile(
  path.join(bundle, "Dockerfile"),
  "FROM oven/bun:1-alpine\nCOPY . .\nENV PORT=3000\nEXPOSE 3000\nCMD [\"bun\", \"server.js\"]\n",
);
await writeFile(
  path.join(bundle, ".dockerignore"),
  ".git\nnode_modules\nnpm-debug.log\n.DS_Store\n",
);
await writeFile(
  path.join(bundle, "railway.json"),
  `${JSON.stringify(
    {
      "$schema": "https://railway.com/railway.schema.json",
      build: { builder: "DOCKERFILE" },
      deploy: { healthcheckPath: "/api/links", healthcheckTimeout: 100 },
    },
    null,
    2,
  )}\n`,
);

run("git", ["add", "-A"], bundle);
const bundleChanged = commitStagedChanges(bundle, "Build generated Snip release bundle");
if (bundleChanged) {
  console.log("Created a new bundle commit.");
} else {
  console.log("Bundle unchanged.");
}

run("git", ["add", "backend", "frontend", "cli", "bundle"], root);
const mainChanged = commitStagedChanges(root, "Update source and generated bundle submodules");
if (mainChanged) {
  console.log("Updated the submodule gitlinks on main.");
} else {
  console.log("Main gitlinks unchanged.");
}

if (publish) {
  run("git", ["push", "origin", "HEAD:bundle"], bundle);
  run("git", ["push", "origin", "main"], root);
}
