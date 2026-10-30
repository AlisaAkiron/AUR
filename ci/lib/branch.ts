// Git side of the long-lived aur/<pkg> branches. Covered by branch.test.ts.

import { $ } from "bun";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { VERSION_TRAILER, versionFromLog } from "./core";

const remoteRef = (branch: string) => `refs/remotes/origin/${branch}`;

/**
 * Ignore build leftovers locally (.git/info/exclude). The runner's clone has
 * no .git/info/ (no git templates), so create it.
 */
export async function addGitExcludes(patterns: string[], cwd: string): Promise<void> {
  const file = resolve(cwd, (await $`git rev-parse --git-path info/exclude`.cwd(cwd).text()).trim());
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, patterns.map((p) => `${p}\n`).join(""));
}

/** Fetch every aur/* branch from origin (check job). */
export async function fetchAurBranches(cwd: string): Promise<void> {
  await $`git fetch -q origin ${"+refs/heads/aur/*:refs/remotes/origin/aur/*"}`.cwd(cwd);
}

/** Upstream version the fetched branch targets; undefined if no branch/trailer. */
export async function branchVersion(branch: string, cwd: string): Promise<string | undefined> {
  const log = await $`git log -n 50 ${`--format=%(trailers:key=${VERSION_TRAILER},valueonly)`} ${remoteRef(branch)}`
    .cwd(cwd)
    .quiet()
    .nothrow()
    .text();
  return versionFromLog(log);
}

export interface BranchStart {
  /** Branch tip on origin when we started, "" if the branch didn't exist. */
  oldSha: string;
  /** True when we continue on the existing commits instead of starting fresh. */
  continued: boolean;
}

/**
 * Check out `branch` for this update. No branch yet, or only commits by
 * `botEmail` on it: start fresh from HEAD (the default branch) and replace it.
 * Someone else pushed to it: continue on top of their commits.
 */
export async function checkoutBranch(
  branch: string,
  botEmail: string,
  cwd: string,
): Promise<BranchStart> {
  const fetched = await $`git fetch -q origin ${`+refs/heads/${branch}:${remoteRef(branch)}`}`
    .cwd(cwd)
    .quiet()
    .nothrow();
  const oldSha =
    fetched.exitCode === 0 ? (await $`git rev-parse ${remoteRef(branch)}`.cwd(cwd).text()).trim() : "";
  let continued = false;
  if (oldSha) {
    const authors = (await $`git log --format=%ae ${`HEAD..${oldSha}`}`.cwd(cwd).text())
      .split("\n")
      .filter(Boolean);
    continued = authors.some((a) => a !== botEmail);
  }
  await $`git checkout -q -B ${branch} ${continued ? oldSha : "HEAD"}`.cwd(cwd);
  return { oldSha, continued };
}

/**
 * Commit the package directory, plus any `extraPaths` (e.g. PACKAGES.md), as
 * the bot, tagged with the upstream version.
 */
export async function commitUpdate(
  o: {
    pkg: string;
    title: string;
    upstreamVersion: string;
    botName: string;
    botEmail: string;
    extraPaths?: string[];
  },
  cwd: string,
): Promise<void> {
  await $`git add -A -- ${o.pkg} ${o.extraPaths ?? []}`.cwd(cwd);
  await $`git -c ${`user.name=${o.botName}`} -c ${`user.email=${o.botEmail}`} commit -q -m ${o.title} -m ${`${VERSION_TRAILER}: ${o.upstreamVersion}`}`.cwd(
    cwd,
  );
}

/**
 * Push HEAD to `branch`. The lease makes it fail instead of overwriting
 * anything pushed while the job ran (oldSha "" = branch must not exist yet).
 */
export async function pushBranch(
  url: string,
  branch: string,
  oldSha: string,
  cwd: string,
): Promise<void> {
  await $`git push -q ${`--force-with-lease=refs/heads/${branch}:${oldSha}`} ${url} ${`HEAD:refs/heads/${branch}`}`.cwd(
    cwd,
  );
}
