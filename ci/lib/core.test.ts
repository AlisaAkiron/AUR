import { describe, expect, test } from "bun:test";
import {
  branchName,
  childPipeline,
  mrDescription,
  mrTitle,
  namcapSection,
  updateType,
  pkgbuildViolations,
  renderPrompt,
  srcinfoVersion,
  versionFromLog,
} from "./core";

describe("branchName", () => {
  test("one branch per package", () => {
    expect(branchName("foo-bin")).toBe("aur/foo-bin");
  });
});

describe("versionFromLog", () => {
  test("newest commit with the trailer wins", () => {
    // human commit on top (no trailer), then bot commits, newest first
    expect(versionFromLog("\n1.43.1\n\n1.43.0\n")).toBe("1.43.1");
  });
  test("no trailer / no branch", () => {
    expect(versionFromLog("")).toBeUndefined();
    expect(versionFromLog("\n\n")).toBeUndefined();
  });
});

describe("renderPrompt", () => {
  const vars = { PKG: "foo", NEWVER: "1.0", REPO: "/builds/x" };
  test("substitutes only known variables", () => {
    expect(renderPrompt("$PKG ${NEWVER} $REPO/SUMMARY.md $HOME", vars)).toBe(
      "foo 1.0 /builds/x/SUMMARY.md $HOME",
    );
  });
  test("leaves longer names alone", () => {
    expect(renderPrompt("edit $PKGBUILD", vars)).toBe("edit $PKGBUILD");
  });
});

describe("childPipeline", () => {
  test("no updates gives a valid noop job", () => {
    const y = Bun.YAML.parse(childPipeline([])) as Record<string, unknown>;
    expect(Object.keys(y)).toEqual(["noop"]);
  });
  test("one job per update", () => {
    const y = Bun.YAML.parse(
      childPipeline([
        { name: "foo", oldver: "1", newver: "2", branch: "aur/foo-2" },
        { name: "bar-bin", oldver: "1", newver: 'a"b', branch: "aur/bar-bin-a_b" },
      ]),
    ) as Record<string, { extends: string; variables: Record<string, string> }>;
    expect(y["update:foo"]).toEqual({
      extends: ".update",
      variables: { PKG: "foo", NEWVER: "2", BRANCH: "aur/foo-2" },
    });
    expect(y["update:bar-bin"]!.variables.NEWVER).toBe('a"b');
    expect(y["update:foo"]!.variables.RELEASE_URL).toBeUndefined();
  });
  test("release URL is passed on when known", () => {
    const y = Bun.YAML.parse(
      childPipeline([
        { name: "foo", oldver: "1", newver: "2", branch: "aur/foo", releaseUrl: "https://x/tag/v2" },
      ]),
    ) as Record<string, { variables: Record<string, string> }>;
    expect(y["update:foo"]!.variables.RELEASE_URL).toBe("https://x/tag/v2");
  });
});

describe("pkgbuildViolations", () => {
  const base = [
    "pkgver=1",
    "sha256sums=('abc')",
    "validpgpkeys=('ABCDEF')",
    "check() {",
    "  make test",
    "}",
  ].join("\n");

  test("normal version bump is fine", () => {
    expect(pkgbuildViolations(base, base.replace("pkgver=1", "pkgver=2"))).toEqual([]);
  });
  test("checksum replaced by SKIP", () => {
    expect(pkgbuildViolations(base, base.replace("'abc'", "'SKIP'"))).toEqual([
      "More checksums set to SKIP than before",
    ]);
  });
  test("existing SKIP (VCS source) is fine", () => {
    const vcs = base.replace("'abc'", "'SKIP'");
    expect(pkgbuildViolations(vcs, vcs.replace("pkgver=1", "pkgver=2"))).toEqual([]);
  });
  test("!check added", () => {
    expect(pkgbuildViolations(base, `${base}\noptions=('!check')`)).toEqual([
      "`!check` added to options",
    ]);
  });
  test("check() removed", () => {
    expect(pkgbuildViolations(base, base.replace(/check\(\) \{[\s\S]*\}/, ""))).toEqual([
      "check() was removed",
    ]);
  });
  test("validpgpkeys removed", () => {
    expect(pkgbuildViolations(base, base.replace("validpgpkeys=('ABCDEF')\n", ""))).toEqual([
      "validpgpkeys was removed",
    ]);
  });
});

describe("srcinfoVersion", () => {
  const srcinfo = (extra = "") =>
    `pkgbase = foo\n\tpkgdesc = x\n\tpkgver = 1.43.1\n\tpkgrel = 1\n${extra}\npkgname = foo\n`;
  test("pkgver-pkgrel", () => {
    expect(srcinfoVersion(srcinfo())).toBe("1.43.1-1");
  });
  test("with epoch", () => {
    expect(srcinfoVersion(srcinfo("\tepoch = 2\n"))).toBe("2:1.43.1-1");
  });
  test("unparseable", () => {
    expect(srcinfoVersion("")).toBeUndefined();
  });
});

describe("updateType", () => {
  test("semver-like versions", () => {
    expect(updateType("1.42.0", "2.0.0")).toBe("major");
    expect(updateType("1.42.0", "1.43.1")).toBe("minor");
    expect(updateType("1.13.0", "1.13.1")).toBe("patch");
    expect(updateType("51.0.0", "52")).toBe("major");
    expect(updateType("1.2", "1.2.1")).toBe("patch");
    expect(updateType("1.2.3.4", "1.2.3.5")).toBe("patch");
    expect(updateType("1.2.3", "1.2.3")).toBe("rebuild");
  });
  test("VCS or unknown versions", () => {
    expect(updateType("0.1.0.r188.gd2f4029", "0.1.0.r190.gabc1234")).toBe("patch");
    expect(updateType("r188.gd2f4029", "r190.gabc1234")).toBe("update");
    expect(updateType(undefined, "1.0")).toBe("update");
  });
});

describe("namcapSection", () => {
  const out = [
    "PKGBUILD (foo) W: Reference to x86_64 should be changed to $CARCH",
    "foo E: Dependency java-runtime detected and not included",
    "foo W: ELF file ('usr/lib/x.node') lacks PIE.",
    "",
  ].join("\n");
  test("errors visible, warnings folded", () => {
    expect(namcapSection(out)).toBe(
      [
        "**namcap:** 1 error, 2 warnings",
        "```\nfoo E: Dependency java-runtime detected and not included\n```",
        "<details><summary>2 warnings</summary>\n\n```\n" +
          "PKGBUILD (foo) W: Reference to x86_64 should be changed to $CARCH\n" +
          "foo W: ELF file ('usr/lib/x.node') lacks PIE.\n```\n\n</details>",
      ].join("\n\n"),
    );
  });
  test("only warnings: nothing visible but the count", () => {
    const s = namcapSection("foo W: a\nfoo W: b\n")!;
    expect(s.startsWith("**namcap:** 0 errors, 2 warnings\n\n<details>")).toBe(true);
  });
  test("clean or empty output: no section", () => {
    expect(namcapSection("")).toBeUndefined();
    expect(namcapSection("\n  \n")).toBeUndefined();
  });
});

describe("MR text", () => {
  test("titles", () => {
    expect(mrTitle("foo", "2-1", { violations: [], buildOk: true })).toBe("foo: 2-1");
    expect(mrTitle("foo", "2-1", { violations: [], buildOk: false })).toBe(
      "Draft: foo: 2-1 (build failing)",
    );
    expect(mrTitle("foo", "2-1", { violations: ["x"], buildOk: false })).toBe(
      "Draft: foo: 2-1 (guard rail violation)",
    );
  });
  const base = {
    change: {
      pkg: "foo",
      homepage: "https://example.org/foo",
      oldPkgver: "1.42.0",
      newPkgver: "1.43.1",
      oldVersion: "1.42.0-1",
      newVersion: "1.43.1-1",
      releaseUrl: "https://github.com/x/foo/releases/tag/v1.43.1",
    },
    summary: "# foo 1.43.1-1\n\n## Changes\n- bumped",
    violations: [],
    notes: [],
    buildOk: true,
    namcap: "",
    agentExitCode: 0,
    cost: 0.0052,
    jobUrl: "https://ci/job/1",
  };
  test("description: update table, release notes, demoted agent headings, footer", () => {
    const d = mrDescription(base);
    expect(d).toContain(
      "| Package | Update | Change |\n|---|---|---|\n" +
        "| [foo](https://example.org/foo) | minor | `1.42.0-1` → `1.43.1-1` |",
    );
    expect(d).toContain("📝 [Release notes](https://github.com/x/foo/releases/tag/v1.43.1)");
    expect(d).toContain(
      "<details><summary><b>Agent summary</b></summary>\n\n#### foo 1.43.1-1\n\n##### Changes\n- bumped\n\n</details>",
    );
    expect(d).toContain("✅ **Build passed**");
    expect(d).toContain("[job](https://ci/job/1) · agent exit code 0 · cost $0.0052");
  });
  test("description without homepage, old version or release URL", () => {
    const d = mrDescription({
      ...base,
      change: { pkg: "foo", newPkgver: "1.0", newVersion: "1.0-1" },
      buildOk: false,
      cost: 0,
    });
    expect(d).toContain("| foo | update | `1.0-1` |");
    expect(d).not.toContain("Release notes");
    expect(d).toContain("❌ **Build FAILED**");
    expect(d).not.toContain("cost $");
  });
});
