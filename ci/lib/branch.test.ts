// Integration tests for branch.ts against real throwaway git repos in $TMPDIR.
// The user's own git config is ignored (no signing, hooks, identities).

import { $ } from "bun";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addGitExcludes,
  branchVersion,
  checkoutBranch,
  commitUpdate,
  fetchAurBranches,
  pushBranch,
} from "./branch";

process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
$.env({ ...process.env });

const BOT = { botName: "pkg-bot", botEmail: "pkg-bot@ci" };
const BRANCH = "aur/foo";
const root = mkdtempSync(join(tmpdir(), "branch-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
let origin: string;
let mainSha: string;

/** Commit as a person (not the bot) and push to `branch`. */
async function humanCommit(branch: string, file: string) {
  const dir = await clone();
  await $`git checkout -q -B ${branch} ${`origin/${branch}`}`.cwd(dir);
  writeFileSync(join(dir, file), "fix\n");
  await $`git add -A`.cwd(dir);
  await $`git -c user.name=Human -c user.email=human@example.com commit -q -m human-fix`.cwd(dir);
  await $`git push -q origin ${`HEAD:refs/heads/${branch}`}`.cwd(dir);
}

/** A fresh clone, detached at main like a CI checkout. */
async function clone(): Promise<string> {
  const dir = join(root, `clone-${n++}`);
  await $`git clone -q ${origin} ${dir}`.quiet();
  await $`git checkout -q --detach origin/main`.cwd(dir);
  return dir;
}

/** One full update job, as update.ts runs it (minus agent and build). */
async function updateJob(version: string) {
  const dir = await clone();
  const start = await checkoutBranch(BRANCH, BOT.botEmail, dir);
  writeFileSync(join(dir, "foo/PKGBUILD"), `pkgver=${version}\n`);
  writeFileSync(join(dir, "PACKAGES.md"), `foo ${version}\n`);
  await commitUpdate(
    { pkg: "foo", title: `foo: ${version}-1`, upstreamVersion: version, extraPaths: ["PACKAGES.md"], ...BOT },
    dir,
  );
  await pushBranch(origin, BRANCH, start.oldSha, dir);
  return { dir, ...start };
}

const remoteLog = async (ref: string) =>
  (await $`git log --format=%ae:%s ${ref}`.cwd(origin).text()).trim().split("\n");

beforeEach(async () => {
  origin = join(root, `origin-${n++}.git`);
  await $`git init -q --bare -b main ${origin}`;
  const seed = join(root, `seed-${n++}`);
  await $`git init -q -b main ${seed}`;
  await $`mkdir -p ${join(seed, "foo")}`;
  writeFileSync(join(seed, "foo/PKGBUILD"), "pkgver=1.0\n");
  writeFileSync(join(seed, "PACKAGES.md"), "foo 1.0\n");
  await $`git add -A`.cwd(seed);
  await $`git -c user.name=Human -c user.email=human@example.com commit -q -m init`.cwd(seed);
  await $`git push -q ${origin} main`.cwd(seed);
  mainSha = (await $`git rev-parse HEAD`.cwd(seed).text()).trim();
});

describe("update job", () => {
  test("no branch yet: creates it from main", async () => {
    const r = await updateJob("1.1");
    expect(r).toMatchObject({ oldSha: "", continued: false });
    expect(await remoteLog(BRANCH)).toEqual(["pkg-bot@ci:foo: 1.1-1", "human@example.com:init"]);
  });

  test("only bot commits: recreated from main, old commit replaced", async () => {
    await updateJob("1.1");
    const r = await updateJob("1.2");
    expect(r.oldSha).not.toBe("");
    expect(r.continued).toBe(false);
    expect(await remoteLog(BRANCH)).toEqual(["pkg-bot@ci:foo: 1.2-1", "human@example.com:init"]);
  });

  test("someone else pushed: continues on top of their commit", async () => {
    await updateJob("1.1");
    await humanCommit(BRANCH, "foo/fix.patch");
    const r = await updateJob("1.2");
    expect(r.continued).toBe(true);
    expect(await remoteLog(BRANCH)).toEqual([
      "pkg-bot@ci:foo: 1.2-1",
      "human@example.com:human-fix",
      "pkg-bot@ci:foo: 1.1-1",
      "human@example.com:init",
    ]);
  });

  test("push during the job: lease rejects, the other push survives", async () => {
    await updateJob("1.1");
    const dir = await clone();
    const start = await checkoutBranch(BRANCH, BOT.botEmail, dir);
    await humanCommit(BRANCH, "foo/fix.patch"); // lands while the agent works
    writeFileSync(join(dir, "foo/PKGBUILD"), "pkgver=1.2\n");
    await commitUpdate({ pkg: "foo", title: "foo: 1.2-1", upstreamVersion: "1.2", ...BOT }, dir);
    await expect(pushBranch(origin, BRANCH, start.oldSha, dir)).rejects.toThrow();
    expect((await remoteLog(BRANCH))[0]).toBe("human@example.com:human-fix");
  });

  test("branch created during the job: empty lease rejects", async () => {
    const dir = await clone();
    const start = await checkoutBranch(BRANCH, BOT.botEmail, dir);
    expect(start.oldSha).toBe("");
    await updateJob("1.1"); // another job got there first
    writeFileSync(join(dir, "foo/PKGBUILD"), "pkgver=1.2\n");
    await commitUpdate({ pkg: "foo", title: "foo: 1.2-1", upstreamVersion: "1.2", ...BOT }, dir);
    await expect(pushBranch(origin, BRANCH, start.oldSha, dir)).rejects.toThrow();
  });

  test("main moved on since the bot commit: recreated on the new main", async () => {
    await updateJob("1.1");
    const other = await clone();
    writeFileSync(join(other, "README"), "x\n");
    await $`git add -A`.cwd(other);
    await $`git -c user.name=Human -c user.email=human@example.com commit -q -m readme`.cwd(other);
    await $`git push -q origin HEAD:refs/heads/main`.cwd(other);
    const r = await updateJob("1.2");
    expect(r.continued).toBe(false);
    expect(await remoteLog(BRANCH)).toEqual([
      "pkg-bot@ci:foo: 1.2-1",
      "human@example.com:readme",
      "human@example.com:init",
    ]);
  });
});

describe("addGitExcludes", () => {
  test("commits the extra paths with the package", async () => {
    await updateJob("2.0");
    const files = (await $`git show --name-only --format= ${`refs/heads/${BRANCH}`}`.cwd(origin).text()).trim();
    expect(files.split("\n").sort()).toEqual(["PACKAGES.md", "foo/PKGBUILD"]);
  });

  test("works in a clone without .git/info (like the GitLab runner's)", async () => {
    const dir = join(root, `bare-template-${n++}`);
    await $`git init -q --template= ${dir}`;
    expect(existsSync(join(dir, ".git/info"))).toBe(false);
    await addGitExcludes(["src/", "*.log"], dir);
    await addGitExcludes(["/SUMMARY.md"], dir);
    expect(readFileSync(join(dir, ".git/info/exclude"), "utf8")).toBe("src/\n*.log\n/SUMMARY.md\n");
    writeFileSync(join(dir, "x.log"), "");
    expect((await $`git status --porcelain`.cwd(dir).text()).trim()).toBe("");
  });
});

describe("check job", () => {
  test("reads the version from the newest trailer, past human commits", async () => {
    await updateJob("1.1");
    await humanCommit(BRANCH, "foo/fix.patch");
    const dir = await clone();
    await fetchAurBranches(dir);
    expect(await branchVersion(BRANCH, dir)).toBe("1.1");
  });

  test("no branch: undefined", async () => {
    const dir = await clone();
    await fetchAurBranches(dir);
    expect(await branchVersion(BRANCH, dir)).toBeUndefined();
  });

  test("main is untouched by all of this", async () => {
    await updateJob("1.1");
    expect((await $`git rev-parse main`.cwd(origin).text()).trim()).toBe(mainSha);
  });
});
