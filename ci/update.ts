// Child pipeline: update one package with the agent, verify, open an MR.
// Run (as root) by the generated update:<pkg> jobs; see .update in .gitlab-ci.yml.
//
// The agent (user builder) can write to this checkout, ci/ included. That's
// safe because Bun loads every static import before running any code, and
// prompts.md is read before builder gets the checkout. Keep it that way: no
// dynamic import() and no reading from ci/ after the chown.

import { $ } from "bun";
import * as fs from "node:fs";
import {
  commitTitle,
  mrDescription,
  mrTitle,
  pkgbuildViolations,
  renderPrompt,
  srcinfoVersion,
} from "./lib/core";
import { addGitExcludes, checkoutBranch, commitUpdate, pushBranch } from "./lib/branch";
import { GitLab } from "./lib/gitlab";
import { env, fail, runTee, warn } from "./lib/proc";

const PKG = env("PKG");
const NEWVER = env("NEWVER");
const BRANCH = env("BRANCH");
const REPO = env("CI_PROJECT_DIR");
const PKG_DIR = `${REPO}/${PKG}`;
const AS_BUILDER = ["sudo", "-u", "builder", "-H"];
process.chdir(REPO);

const git = {
  head: async () => (await $`git rev-parse HEAD`.text()).trim(),
};

// ---- Agent + unprivileged build user -----------------------------------------
if (!Bun.which("omp")) fail("omp not on PATH after install");
if ((await $`id builder`.quiet().nothrow()).exitCode !== 0) await $`useradd -m builder`;
fs.writeFileSync("/etc/sudoers.d/builder", "builder ALL=(ALL) NOPASSWD: /usr/bin/pacman\n", {
  mode: 0o440,
});

// Optional OMP provider/model config (file-type CI variables)
const ompDir = "/home/builder/.omp/agent";
fs.mkdirSync(ompDir, { recursive: true });
for (const [variable, file] of [
  ["OMP_MODELS_YML", "models.yml"],
  ["OMP_CONFIG_YML", "config.yml"],
] as const) {
  const src = process.env[variable];
  if (src) fs.copyFileSync(src, `${ompDir}/${file}`);
}
await $`chown -R builder: /home/builder/.omp`;
fs.mkdirSync(env("SRCDEST"), { recursive: true });
await addGitExcludes(["src/", "pkg/", "*.pkg.tar.*", "*.log", "/SUMMARY.md", "/.srcdest/"], REPO);

// Read the prompt from this pipeline's commit, before checking anything else out
const prompt = renderPrompt(fs.readFileSync("ci/prompts.md", "utf8"), {
  PKG,
  NEWVER,
  REPO,
});

// ---- Pick the starting point -------------------------------------------------
// No aur/<pkg> branch yet, or only bot commits on it: start fresh from this
// pipeline's commit (the default branch) and replace the branch.
// Someone else pushed to it: continue on top of their commits.
const notes: string[] = [];
const botEmail = env("BOT_EMAIL");
const { oldSha, continued } = await checkoutBranch(BRANCH, botEmail, REPO);
if (continued) {
  notes.push(`Continued on top of existing commits on \`${BRANCH}\` (not only from the bot).`);
}
console.log(
  `Branch ${BRANCH}: ${!oldSha ? "new" : continued ? "continuing existing commits" : "recreated from default branch"}`,
);

// Keep the job token away from the agent and upstream build scripts: the runner
// stores it in the clone's remote URL / git config, and file-type variables
// live in the .tmp dir next to the checkout.
await $`git remote set-url origin ${env("CI_PROJECT_URL") + ".git"}`;
await $`git config --local --unset-all credential.helper`.quiet().nothrow();
const extraHeaders = await $`git config --local --name-only --get-regexp ${"^http\\..*extraheader$"}`
  .nothrow()
  .text();
for (const key of extraHeaders.split("\n").filter(Boolean)) {
  await $`git config --local --unset-all ${key}`.quiet().nothrow();
}
try {
  fs.chmodSync(`${REPO}.tmp`, 0o700);
} catch {}

// The prompt was read above, while ci/ was still root-owned
await $`chown -R builder: ${REPO}`;
const startHead = await git.head();

// ---- Run the agent -----------------------------------------------------------
const preserveEnv = [env("AGENT_ENV"), "SRCDEST", "PKG", "NEWVER", "CI_PROJECT_DIR"].join(",");
const agentExitCode = await runTee(
  [
    "timeout",
    env("AGENT_TIMEOUT"),
    ...AS_BUILDER,
    `--preserve-env=${preserveEnv}`,
    ...env("AGENT_CMD").split(/\s+/).filter(Boolean),
    "--max-cost",
    env("AGENT_MAX_COST"),
    "--model",
    env("AGENT_MODEL"),
    prompt,
  ],
  { cwd: PKG_DIR, logFile: `${REPO}/agent.log` },
);
console.log(`Agent exited with code ${agentExitCode}`);

// ---- Guard rails -------------------------------------------------------------
// Agent committed despite the rules: undo the commits, keep the changes
if ((await git.head()) !== startHead) {
  warn(`agent created commits; resetting to ${startHead}`);
  await $`git reset -q --soft ${startHead}`;
  notes.push("The agent made git commits despite instructions; CI undid them and kept the changes.");
}

const outside = (
  await $`git status --porcelain --untracked-files=all -- . ${`:(exclude)${PKG}`}`.text()
).trim();
if (outside) fail(`agent modified files outside ${PKG}/:\n${outside}`);

const changed =
  (await $`git diff --quiet HEAD -- ${PKG}`.quiet().nothrow()).exitCode !== 0 ||
  (await $`git ls-files --others --exclude-standard -- ${PKG}`.text()).trim() !== "";
if (!changed) fail(`agent made no changes to ${PKG}`);

const violations = pkgbuildViolations(
  await $`git show ${`${startHead}:${PKG}/PKGBUILD`}`.text(),
  fs.readFileSync(`${PKG_DIR}/PKGBUILD`, "utf8"),
);
if (violations.length) console.log(`Guard rail violations:\n- ${violations.join("\n- ")}`);

// ---- Independent verdict: rebuild ourselves (clean src/) ---------------------
const build = await $`${AS_BUILDER} --preserve-env=SRCDEST makepkg -CsfL --noconfirm`
  .cwd(PKG_DIR)
  .nothrow();
const buildOk = build.exitCode === 0;
let namcap = "";
if (buildOk) {
  const packages = fs.readdirSync(PKG_DIR).filter((f) => f.includes(".pkg.tar."));
  namcap = await $`namcap PKGBUILD ${packages} 2>&1`.cwd(PKG_DIR).nothrow().text();
  fs.writeFileSync(`${REPO}/namcap.txt`, namcap);
}
const srcinfo = await $`${AS_BUILDER} makepkg --printsrcinfo`.cwd(PKG_DIR).text();
fs.writeFileSync(`${PKG_DIR}/.SRCINFO`, srcinfo);
// Version as packaged (pkgver may differ from the upstream text), e.g. 1.2.3-1
const fullVersion = srcinfoVersion(srcinfo) ?? NEWVER;

// ---- Commit, push --------------------------------------------------------------
const summaryFile = `${REPO}/SUMMARY.md`;
if (!fs.existsSync(summaryFile) || fs.statSync(summaryFile).size === 0) {
  fs.writeFileSync(
    summaryFile,
    "_The agent did not write a summary; see agent.log in the job artifacts._\n",
  );
}
await commitUpdate(
  {
    pkg: PKG,
    title: commitTitle(PKG, fullVersion),
    upstreamVersion: NEWVER,
    botName: env("BOT_NAME"),
    botEmail,
  },
  REPO,
);
const pushUrl = `${env("CI_SERVER_PROTOCOL")}://oauth2:${env("BOT_TOKEN")}@${env("CI_SERVER_HOST")}:${env("CI_SERVER_PORT")}/${env("CI_PROJECT_PATH")}.git`;
await pushBranch(pushUrl, BRANCH, oldSha, REPO);

// ---- Open or update the MR (draft if the build failed or a guard tripped) ----
const gitlab = new GitLab(env("CI_API_V4_URL"), env("CI_PROJECT_ID"), env("BOT_TOKEN"));
const outcome = { violations, buildOk };
const title = mrTitle(PKG, fullVersion, outcome);
const description = mrDescription({
  ...outcome,
  summary: fs.readFileSync(summaryFile, "utf8"),
  notes,
  namcap,
  agentExitCode,
  jobUrl: env("CI_JOB_URL"),
});
const existing = await gitlab.openMergeRequestFor(BRANCH);
if (existing) {
  await gitlab.updateMergeRequest(existing.iid, {
    title,
    description,
    add_labels: env("MR_LABELS"),
  });
  await gitlab
    .comment(existing.iid, `Updated to ${NEWVER}. Job: ${env("CI_JOB_URL")}`)
    .catch((e) => warn(`could not comment on !${existing.iid}: ${e}`));
  console.log(`Updated MR: ${existing.web_url}`);
} else {
  const mr = await gitlab.createMergeRequest({
    source_branch: BRANCH,
    target_branch: env("CI_DEFAULT_BRANCH"),
    title,
    description,
    labels: env("MR_LABELS"),
    remove_source_branch: true,
  });
  console.log(`Opened MR: ${mr.web_url}`);
}

if (violations.length) fail("guard rail violation; the MR is a draft for a human to review.");
if (!buildOk) fail("build failed; the MR is a draft, and this version won't be retried every run.");
