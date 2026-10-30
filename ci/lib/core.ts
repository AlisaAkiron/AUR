// Pure helpers shared by check.ts and update.ts. No I/O here, so it's all
// covered by core.test.ts.

export interface Update {
  name: string;
  oldver: string;
  newver: string;
  branch: string;
  /** Release page reported by nvchecker, if any. */
  releaseUrl?: string;
}

/** One long-lived branch (and MR) per package, updated in place. */
export function branchName(pkg: string): string {
  return `aur/${pkg}`;
}

/** Git trailer on every bot commit recording the upstream version it targets. */
export const VERSION_TRAILER = "Upstream-Version";

/**
 * Upstream version a branch targets, from the output of
 * `git log --format=%(trailers:key=Upstream-Version,valueonly)`:
 * the newest commit that has the trailer wins.
 */
export function versionFromLog(log: string): string | undefined {
  return log
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
}

/** Fill $PKG / $NEWVER / $REPO (or ${...}) in the prompt; nothing else. */
export function renderPrompt(
  template: string,
  vars: { PKG: string; NEWVER: string; REPO: string },
): string {
  return template.replace(
    /\$(?:\{(PKG|NEWVER|REPO)\}|(PKG|NEWVER|REPO)\b)/g,
    (_, braced: string | undefined, bare: string | undefined) =>
      vars[(braced ?? bare) as keyof typeof vars],
  );
}

/** Generated child pipeline: one job per update, or a no-op job. */
export function childPipeline(todo: Update[]): string {
  if (todo.length === 0) {
    return [
      "noop:",
      // Stages here must exist in .gitlab-ci.yml (the default "test" doesn't)
      "  stage: update",
      "  image: alpine:latest",
      "  rules:",
      '    - if: $CI_PIPELINE_SOURCE == "parent_pipeline"',
      "  script:",
      '    - echo "Nothing to update"',
      "",
    ].join("\n");
  }
  const q = JSON.stringify; // JSON strings are valid YAML scalars
  return todo
    .map((u) =>
      [
        `${q(`update:${u.name}`)}:`,
        "  extends: .update",
        "  variables:",
        `    PKG: ${q(u.name)}`,
        `    NEWVER: ${q(u.newver)}`,
        `    BRANCH: ${q(u.branch)}`,
        ...(u.releaseUrl ? [`    RELEASE_URL: ${q(u.releaseUrl)}`] : []),
        "",
      ].join("\n"),
    )
    .join("\n");
}

/**
 * Ways the agent could have weakened the PKGBUILD to make a build pass.
 * Text checks only: the PKGBUILD is never sourced as root.
 */
export function pkgbuildViolations(oldPb: string, newPb: string): string[] {
  const count = (re: RegExp, s: string) => s.match(re)?.length ?? 0;
  const out: string[] = [];
  if (count(/SKIP/g, newPb) > count(/SKIP/g, oldPb)) {
    out.push("More checksums set to SKIP than before");
  }
  if (count(/!check/g, newPb) > count(/!check/g, oldPb)) {
    out.push("`!check` added to options");
  }
  if (count(/^check\(\)/gm, oldPb) > 0 && count(/^check\(\)/gm, newPb) === 0) {
    out.push("check() was removed");
  }
  if (count(/^validpgpkeys=/gm, oldPb) > 0 && count(/^validpgpkeys=/gm, newPb) === 0) {
    out.push("validpgpkeys was removed");
  }
  return out;
}

export interface Outcome {
  violations: string[];
  buildOk: boolean;
}

/** First value of a pkgbase field (pkgver, url, ...) in .SRCINFO text. */
export function srcinfoField(srcinfo: string, key: string): string | undefined {
  return srcinfo.match(new RegExp(`^\\t${key} = (.+)$`, "m"))?.[1];
}

/** Full package version ([epoch:]pkgver-pkgrel) from .SRCINFO text. */
export function srcinfoVersion(srcinfo: string): string | undefined {
  const field = (key: string) => srcinfoField(srcinfo, key);
  const [epoch, pkgver, pkgrel] = [field("epoch"), field("pkgver"), field("pkgrel")];
  if (!pkgver || !pkgrel) return undefined;
  return `${epoch ? `${epoch}:` : ""}${pkgver}-${pkgrel}`;
}

/** Commit message / MR title, like the repo's history: "foo: 1.2.3-1". */
export function commitTitle(pkg: string, fullVersion: string): string {
  return `${pkg}: ${fullVersion}`;
}

export function mrTitle(pkg: string, fullVersion: string, o: Outcome): string {
  const title = commitTitle(pkg, fullVersion);
  if (o.violations.length) return `Draft: ${title} (guard rail violation)`;
  if (!o.buildOk) return `Draft: ${title} (build failing)`;
  return title;
}

const bullets = (items: string[]) => items.map((i) => `- ${i}`).join("\n");

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** namcap output for the MR: errors visible, warnings folded away. */
export function namcapSection(output: string): string | undefined {
  const lines = output.split("\n").filter((l) => l.trim());
  if (!lines.length) return undefined;
  const errors = lines.filter((l) => /\sE: /.test(l));
  const rest = lines.filter((l) => !/\sE: /.test(l));
  const block = (ls: string[]) => `\`\`\`\n${ls.join("\n")}\n\`\`\``;
  const parts = [`**namcap:** ${plural(errors.length, "error")}, ${plural(rest.length, "warning")}`];
  if (errors.length) parts.push(block(errors));
  if (rest.length) {
    // Blank lines around the code block so GitLab renders markdown inside <details>
    parts.push(`<details><summary>${plural(rest.length, "warning")}</summary>\n\n${block(rest)}\n\n</details>`);
  }
  return parts.join("\n\n");
}

/**
 * Renovate-style update type from two pkgvers: which dot-separated part
 * changed first (major / minor / patch). Anything that doesn't line up as
 * numbers (VCS versions like 0.1.0.r188.gd2f4029 -> ...r190...) is "update".
 */
export function updateType(oldVer: string | undefined, newVer: string): string {
  if (!oldVer) return "update";
  const parts = (v: string) => v.split(".");
  const [a, b] = [parts(oldVer), parts(newVer)];
  const numeric = (p: string[]) => p.slice(0, 3).every((x) => /^\d+$/.test(x));
  if (!numeric(a) || !numeric(b)) return "update";
  const names = ["major", "minor", "patch"];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? "0") !== (b[i] ?? "0")) return names[i]!;
  }
  return a.join(".") === b.join(".") ? "rebuild" : "patch";
}

/** Push the agent's headings below ours (its "# Title" becomes "#### Title"). */
function demoteHeadings(markdown: string): string {
  return markdown.replace(/^(#{1,6}) /gm, (_, h: string) => `${"#".repeat(Math.min(h.length + 3, 6))} `);
}

export interface PackageChange {
  pkg: string;
  /** Upstream project URL (PKGBUILD url=). */
  homepage?: string;
  /** pkgver before / after, for the update type. */
  oldPkgver?: string;
  newPkgver: string;
  /** Full versions ([epoch:]pkgver-pkgrel) before / after. */
  oldVersion?: string;
  newVersion: string;
  /** Release page reported by nvchecker. */
  releaseUrl?: string;
}

export function mrDescription(
  o: Outcome & {
    change: PackageChange;
    summary: string;
    notes: string[];
    namcap: string;
    agentExitCode: number;
    cost: number;
    jobUrl: string;
  },
): string {
  const c = o.change;
  const name = c.homepage ? `[${c.pkg}](${c.homepage})` : c.pkg;
  const from = c.oldVersion ? `\`${c.oldVersion}\` → ` : "";
  const parts = [
    "This MR contains the following updates:",
    [
      "| Package | Update | Change |",
      "|---|---|---|",
      `| ${name} | ${updateType(c.oldPkgver, c.newPkgver)} | ${from}\`${c.newVersion}\` |`,
    ].join("\n"),
  ];
  if (c.releaseUrl) parts.push(`📝 [Release notes](${c.releaseUrl})`);

  // Folded; blank lines around it so GitLab renders the markdown inside <details>
  parts.push(
    "---",
    `<details><summary><b>Agent summary</b></summary>\n\n${demoteHeadings(o.summary.trim())}\n\n</details>`,
  );

  parts.push("---", "### CI verification");
  if (o.violations.length) {
    parts.push(`⚠️ **Guard rail violations (do not merge as-is):**\n${bullets(o.violations)}`);
  }
  if (o.notes.length) parts.push(`**CI notes:**\n${bullets(o.notes)}`);
  if (o.buildOk) {
    parts.push("✅ **Build passed** (verified by CI after the agent finished)");
    const namcap = namcapSection(o.namcap);
    if (namcap) parts.push(namcap);
  } else {
    parts.push("❌ **Build FAILED** in CI verification");
  }

  const cost = o.cost ? ` · cost $${o.cost.toFixed(4)}` : "";
  parts.push(
    "---",
    `🤖 Created by the PKGBUILD updater · [job](${o.jobUrl}) · agent exit code ${o.agentExitCode}${cost}  \n` +
      "Newer upstream versions update this MR in place. Pushing your own commits to the branch is fine: " +
      "the next update continues on top of them.",
  );
  return parts.join("\n\n") + "\n";
}
