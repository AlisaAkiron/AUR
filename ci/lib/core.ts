// Pure helpers shared by check.ts and update.ts. No I/O here, so it's all
// covered by core.test.ts.

export interface Update {
  name: string;
  oldver: string;
  newver: string;
  branch: string;
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

/** Full package version ([epoch:]pkgver-pkgrel) from .SRCINFO text. */
export function srcinfoVersion(srcinfo: string): string | undefined {
  const field = (key: string) => srcinfo.match(new RegExp(`^\\t${key} = (.+)$`, "m"))?.[1];
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

export function mrDescription(
  o: Outcome & {
    summary: string;
    notes: string[];
    namcap: string;
    agentExitCode: number;
    jobUrl: string;
  },
): string {
  const parts = [o.summary.trim(), "---"];
  if (o.violations.length) {
    parts.push(`**Guard rail violations (do not merge as-is):**\n${bullets(o.violations)}`);
  }
  if (o.notes.length) parts.push(`**CI notes:**\n${bullets(o.notes)}`);
  if (o.buildOk) {
    parts.push("**Build:** passed (verified by CI after the agent finished)");
    if (o.namcap.trim()) parts.push(`**namcap:**\n\`\`\`\n${o.namcap.trim()}\n\`\`\``);
  } else {
    parts.push("**Build:** FAILED in CI verification");
  }
  parts.push(`Agent exit code: ${o.agentExitCode}  \nJob: ${o.jobUrl}`);
  return parts.join("\n\n") + "\n";
}
