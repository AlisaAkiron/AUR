// Parent pipeline: find outdated packages and generate child.yml.
// Run by the `check` job in .gitlab-ci.yml (variables come from there).

import { $ } from "bun";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { branchVersion, fetchAurBranches } from "./lib/branch";
import { branchName, childPipeline, type Update } from "./lib/core";
import { env, fail } from "./lib/proc";

if (env("AGENT_MODEL").includes("CHANGE_ME")) {
  fail("set AGENT_MODEL in .gitlab-ci.yml or in Settings -> CI/CD -> Variables first");
}
const maxUpdates = Number(process.env.MAX_UPDATES ?? "10");
const writeJson = (file: string, data: unknown) =>
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");

// 1. Current versions, taken from each package's .SRCINFO
const current: Record<string, { version: string }> = {};
for (const dir of readdirSync(".", { withFileTypes: true })) {
  const srcinfo = `${dir.name}/.SRCINFO`;
  if (!dir.isDirectory() || !existsSync(srcinfo)) continue;
  const pkgver = readFileSync(srcinfo, "utf8").match(/^\tpkgver = (.+)$/m)?.[1];
  if (pkgver) current[dir.name] = { version: pkgver };
}
writeJson("old_ver.json", { version: 2, data: current });

// 2. Latest upstream versions. nvchecker only reads tokens from a keyfile, but a
//    multi-line keyfile can't be a masked CI/CD variable, so GITHUB_TOKEN
//    (one word, maskable) is written into a private temporary keyfile.
let keyfile = process.env.NVCHECKER_KEYFILE;
let tmpKeyDir: string | undefined;
if (!keyfile && process.env.GITHUB_TOKEN) {
  tmpKeyDir = mkdtempSync(join(tmpdir(), "nvchecker-"));
  keyfile = join(tmpKeyDir, "keyfile.toml");
  writeFileSync(keyfile, `[keys]\ngithub = ${JSON.stringify(process.env.GITHUB_TOKEN)}\n`, {
    mode: 0o600,
  });
}
try {
  await $`nvchecker -c nvchecker.toml ${keyfile ? ["-k", keyfile] : []}`;
} finally {
  if (tmpKeyDir) rmSync(tmpKeyDir, { recursive: true, force: true });
}
const outdated: { name: string; oldver?: string | null; newver?: string | null }[] =
  await $`nvcmp -c nvchecker.toml --json`.json();

// Release pages nvchecker found (GitHub releases, GitLab tags, ...), for the MR
const newVer = JSON.parse(readFileSync("new_ver.json", "utf8")) as {
  data: Record<string, { url?: string | null }>;
};
const releaseUrls: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(newVer.data).map(([name, entry]) => [name, entry.url ?? undefined]),
);

// 3. Skip packages whose aur/<pkg> branch already targets this version
//    (open MR, or a failed draft that shouldn't be retried every run), cap count
await fetchAurBranches(".");
const todo: Update[] = [];
for (const u of outdated) {
  if (u.oldver == null || u.newver == null) continue;
  const branch = branchName(u.name);
  const onBranch = await branchVersion(branch, ".");
  if (onBranch === u.newver) {
    console.log(`  ${u.name}: ${branch} already targets ${u.newver}, skipping`);
    continue;
  }
  todo.push({ name: u.name, oldver: u.oldver, newver: u.newver, branch, releaseUrl: releaseUrls[u.name] });
  if (todo.length >= maxUpdates) break;
}
writeJson("todo.json", todo);

console.log(`Packages to update: ${todo.length}`);
for (const u of todo) console.log(`  ${u.name}: ${u.oldver} -> ${u.newver}`);

// 4. Generate the child pipeline jobs
const child = childPipeline(todo);
writeFileSync("child.yml", child);
console.log(child);
