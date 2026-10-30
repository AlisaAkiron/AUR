// Turns omp's `--mode json` event stream into a short, readable, redacted log.
// Job logs and artifacts are public, and GitLab masks variables only in job
// logs (not in artifacts), so everything written goes through a Redactor.
// Covered by agentlog.test.ts.

export type Redactor = (text: string) => string;

/**
 * Replace every secret value with [REDACTED]. URL values (proxies, Nexus)
 * also get their hostname and credentials redacted on their own, since
 * error messages often print just the host ("Could not resolve proxy: ...").
 */
export function createRedactor(values: (string | undefined)[]): Redactor {
  const needles = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    needles.add(value);
    try {
      const url = new URL(value);
      for (const part of [url.hostname, url.username, decodeURIComponent(url.password)]) {
        if (part) needles.add(part);
      }
    } catch {}
  }
  // Longest first, and skip tiny values that would shred normal text
  const sorted = [...needles].filter((n) => n.length >= 6).sort((a, b) => b.length - a.length);
  return (text) => sorted.reduce((t, n) => t.split(n).join("[REDACTED]"), text);
}

interface ContentPart {
  type: string;
  text?: string;
}

export interface FormatOptions {
  /** Lines of each tool's output to keep (from the end). */
  outputLines: number;
  /** Max characters of a tool's arguments. */
  argChars: number;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as ContentPart[])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}

function describeArgs(tool: string, args: Record<string, unknown> | undefined, max: number): string {
  if (!args) return "";
  if (tool === "bash" && typeof args.command === "string") return clip(args.command, max);
  const target = args.path ?? args.file_path ?? args.pattern ?? args.query;
  if (typeof target === "string") return clip(target, max);
  return clip(JSON.stringify(args), max);
}

/** Lines to print for one event; [] for the noisy ones (deltas, updates). */
export function formatEvent(event: any, opts: FormatOptions): string[] {
  switch (event?.type) {
    case "tool_execution_start": {
      const intent = typeof event.intent === "string" && event.intent ? `  # ${clip(event.intent, 120)}` : "";
      return [`▶ ${event.toolName}: ${describeArgs(event.toolName, event.args, opts.argChars)}${intent}`];
    }
    case "tool_execution_end": {
      const out = textOf(event.result?.content).trimEnd();
      const lines = out ? out.split("\n") : [];
      const shown = lines.slice(-opts.outputLines);
      const header = `${event.isError ? "✘" : "✔"} ${event.toolName}${
        lines.length > shown.length ? ` (last ${shown.length} of ${lines.length} lines)` : ""
      }`;
      return [header, ...shown.map((l) => `    ${l}`)];
    }
    case "message_end": {
      const m = event.message;
      if (m?.role !== "assistant") return [];
      const out: string[] = [];
      const text = textOf(m.content).trim();
      if (text) out.push(...text.split("\n").map((l, i) => (i === 0 ? `💬 ${l}` : `   ${l}`)));
      if (m.stopReason === "error" && m.errorMessage) out.push(`✘ model error: ${m.errorMessage}`);
      return out;
    }
    default:
      return [];
  }
}

/** Running total of the cost omp reports per assistant message, if any. */
export function messageCost(event: any): number {
  if (event?.type !== "message_end" || event.message?.role !== "assistant") return 0;
  const cost = event.message?.usage?.cost;
  const total = typeof cost === "number" ? cost : cost?.total;
  return typeof total === "number" ? total : 0;
}

/** The last assistant text: the agent's final answer. */
export function finalAnswer(event: any): string | undefined {
  if (event?.type !== "message_end" || event.message?.role !== "assistant") return undefined;
  const text = textOf(event.message.content).trim();
  return text || undefined;
}
