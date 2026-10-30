// Process / environment helpers.

import {
  finalAnswer,
  formatEvent,
  type FormatOptions,
  messageCost,
  type Redactor,
} from "./agentlog";

/** Required environment variable (set by GitLab or .gitlab-ci.yml). */
export function env(name: string): string {
  const value = process.env[name];
  if (!value) fail(`missing environment variable ${name}`);
  return value;
}

export function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

export function warn(message: string): void {
  console.log(`WARNING: ${message}`);
}

async function eachLine(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      onLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) onLine(buffer);
}

/**
 * Run omp in `--mode json`: print a short summary of each step to the job
 * log, a longer one to `logFile`, both redacted. Non-JSON output passes
 * through (redacted).
 */
export async function runAgent(
  cmd: string[],
  opts: { cwd: string; logFile: string; redact: Redactor },
): Promise<{ exitCode: number; answer?: string; cost: number }> {
  const proc = Bun.spawn(cmd, { cwd: opts.cwd, stdout: "pipe", stderr: "pipe" });
  const log = Bun.file(opts.logFile).writer();
  const write = (jobLines: string[], fileLines: string[]) => {
    for (const l of jobLines) console.log(opts.redact(l));
    for (const l of fileLines) log.write(`${opts.redact(l)}\n`);
  };
  let answer: string | undefined;
  let cost = 0;
  const onStdout = (line: string) => {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return write([line], [line]);
    }
    cost += messageCost(event);
    answer = finalAnswer(event) ?? answer;
    write(formatEvent(event, JOB_LOG), formatEvent(event, FILE_LOG));
  };
  const onStderr = (line: string) => write([line], [line]);
  await Promise.all([eachLine(proc.stdout, onStdout), eachLine(proc.stderr, onStderr)]);
  await log.end();
  return { exitCode: await proc.exited, answer: answer && opts.redact(answer), cost };
}

const JOB_LOG: FormatOptions = { outputLines: 8, argChars: 300 };
const FILE_LOG: FormatOptions = { outputLines: 200, argChars: 4000 };
