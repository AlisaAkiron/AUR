import { describe, expect, test } from "bun:test";
import {
  branchName,
  childPipeline,
  mrDescription,
  mrTitle,
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
  test("description", () => {
    const d = mrDescription({
      summary: "Bumped.",
      violations: [],
      notes: [],
      buildOk: true,
      namcap: "",
      agentExitCode: 0,
      jobUrl: "https://ci/job/1",
    });
    expect(d.startsWith("Bumped.\n")).toBe(true);
    expect(d).toContain("**Build:** passed");
  });
});
