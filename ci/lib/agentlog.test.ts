import { describe, expect, test } from "bun:test";
import { createRedactor, finalAnswer, formatEvent, messageCost } from "./agentlog";

const opts = { outputLines: 3, argChars: 40 };

describe("createRedactor", () => {
  test("redacts secret values, longest first", () => {
    const r = createRedactor(["sk-or-v1-abcdef123456", undefined, ""]);
    expect(r("key=sk-or-v1-abcdef123456 done")).toBe("key=[REDACTED] done");
  });
  test("URL secrets: whole URL, host and credentials separately", () => {
    const r = createRedactor(["http://user:p%40ssword@mihomo.example.internal:7890"]);
    expect(r("proxy http://user:p%40ssword@mihomo.example.internal:7890")).toBe("proxy [REDACTED]");
    expect(r("Could not resolve proxy: mihomo.example.internal")).toBe(
      "Could not resolve proxy: [REDACTED]",
    );
    expect(r("auth p@ssword")).toBe("auth [REDACTED]");
  });
  test("ignores tiny values that would shred normal text", () => {
    const r = createRedactor(["abc", "http://x:1"]);
    expect(r("abc x http://x:1")).toBe("abc x [REDACTED]");
  });
});

describe("formatEvent", () => {
  test("bash tool start shows the command and intent", () => {
    expect(
      formatEvent(
        { type: "tool_execution_start", toolName: "bash", args: { command: "updpkgsums" }, intent: "refresh sums" },
        opts,
      ),
    ).toEqual(["▶ bash: updpkgsums  # refresh sums"]);
  });
  test("long arguments are clipped; file tools show the path", () => {
    expect(
      formatEvent({ type: "tool_execution_start", toolName: "bash", args: { command: "x".repeat(100) } }, opts)[0],
    ).toBe(`▶ bash: ${"x".repeat(40)}…`);
    expect(
      formatEvent(
        { type: "tool_execution_start", toolName: "write", args: { path: "PKGBUILD", content: "secret stuff" } },
        opts,
      ),
    ).toEqual(["▶ write: PKGBUILD"]);
  });
  test("tool end keeps the last lines of output", () => {
    const result = { content: [{ type: "text", text: "1\n2\n3\n4\n5\n" }] };
    expect(formatEvent({ type: "tool_execution_end", toolName: "bash", result, isError: false }, opts)).toEqual([
      "✔ bash (last 3 of 5 lines)",
      "    3",
      "    4",
      "    5",
    ]);
    expect(
      formatEvent({ type: "tool_execution_end", toolName: "bash", result: { content: [] }, isError: true }, opts),
    ).toEqual(["✘ bash"]);
  });
  test("assistant text is shown, thinking and other roles are not", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "Bumped to 1.2.\nBuilding now." },
      ],
    };
    expect(formatEvent({ type: "message_end", message }, opts)).toEqual([
      "💬 Bumped to 1.2.",
      "   Building now.",
    ]);
    expect(formatEvent({ type: "message_end", message: { role: "user", content: "x" } }, opts)).toEqual([]);
  });
  test("model errors are reported", () => {
    const message = { role: "assistant", content: [], stopReason: "error", errorMessage: "rate limited" };
    expect(formatEvent({ type: "message_end", message }, opts)).toEqual(["✘ model error: rate limited"]);
  });
  test("streaming deltas and unknown events are dropped", () => {
    for (const type of ["message_update", "tool_execution_update", "turn_start", "agent_end"]) {
      expect(formatEvent({ type }, opts)).toEqual([]);
    }
    expect(formatEvent(null, opts)).toEqual([]);
  });
});

describe("cost and final answer", () => {
  const end = (usage: unknown, text = "done") => ({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }], usage },
  });
  test("cost from usage.cost.total or a plain number", () => {
    expect(messageCost(end({ cost: { total: 0.0123 } }))).toBe(0.0123);
    expect(messageCost(end({ cost: 0.5 }))).toBe(0.5);
    expect(messageCost(end(undefined))).toBe(0);
    expect(messageCost({ type: "tool_execution_end" })).toBe(0);
  });
  test("final answer is the assistant text", () => {
    expect(finalAnswer(end(undefined, "All good"))).toBe("All good");
    expect(finalAnswer(end(undefined, "  "))).toBeUndefined();
  });
});
