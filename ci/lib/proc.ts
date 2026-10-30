// Process / environment helpers.

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

/** Run a command, streaming stdout+stderr to the job log and to `logFile`. */
export async function runTee(
  cmd: string[],
  opts: { cwd: string; logFile: string },
): Promise<number> {
  const proc = Bun.spawn(cmd, { cwd: opts.cwd, stdout: "pipe", stderr: "pipe" });
  const log = Bun.file(opts.logFile).writer();
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) {
      process.stdout.write(chunk);
      log.write(chunk);
    }
  };
  await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
  await log.end();
  return proc.exited;
}
