import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { runCommandWithTimeout } from "openclaw/plugin-sdk/process-runtime";

export type UniverOfficeConfig = {
  cliPath: string;
  commandTimeoutMs: number;
  maxOutputBytes: number;
  screenshotMaxImages: number;
};

export type UniverCliInvocation = {
  args: string[];
  cwd: string;
  parseJson?: boolean;
  signal: AbortSignal | undefined;
  timeoutMs?: number;
};

export type UniverCliOutput = {
  data: unknown;
  stdout: string;
};

export type UniverCliRunner = (invocation: UniverCliInvocation) => Promise<UniverCliOutput>;

const DEFAULT_CONFIG: UniverOfficeConfig = {
  cliPath: "univer-workspace-cli",
  commandTimeoutMs: 120_000,
  maxOutputBytes: 2 * 1024 * 1024,
  screenshotMaxImages: 12,
};

function readPositiveInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

export function parseUniverOfficeConfig(value: unknown): UniverOfficeConfig {
  const config = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const cliPath = typeof config.cliPath === "string" && config.cliPath.trim()
    ? config.cliPath.trim()
    : DEFAULT_CONFIG.cliPath;
  return {
    cliPath,
    commandTimeoutMs: readPositiveInteger(
      config.commandTimeoutMs,
      DEFAULT_CONFIG.commandTimeoutMs,
      1_000,
      600_000,
    ),
    maxOutputBytes: readPositiveInteger(
      config.maxOutputBytes,
      DEFAULT_CONFIG.maxOutputBytes,
      1_024,
      16 * 1024 * 1024,
    ),
    screenshotMaxImages: readPositiveInteger(
      config.screenshotMaxImages,
      DEFAULT_CONFIG.screenshotMaxImages,
      1,
      30,
    ),
  };
}

function commandFailureMessage(params: {
  args: string[];
  code: number | null;
  stderr: string;
  termination: string;
}): string {
  const diagnostic = params.stderr.trim();
  const detail = diagnostic || `termination=${params.termination}, code=${params.code ?? "unknown"}`;
  return `Univer Workspace command failed (${params.args.slice(0, 3).join(" ")}): ${detail}`;
}

export function createUniverCliRunner(config: UniverOfficeConfig): UniverCliRunner {
  return async ({ args, cwd, parseJson = true, signal, timeoutMs }) => {
    const result = await runCommandWithTimeout([config.cliPath, ...args], {
      cwd,
      timeoutMs: timeoutMs ?? config.commandTimeoutMs,
      killProcessTree: true,
      maxOutputBytes: config.maxOutputBytes,
      ...(signal ? { signal } : {}),
    });
    const outputTruncated =
      (result.stdoutTruncatedBytes ?? 0) > 0 || (result.stderrTruncatedBytes ?? 0) > 0;
    if (result.termination !== "exit" || result.code !== 0 || outputTruncated) {
      throw new Error(
        commandFailureMessage({
          args,
          code: result.code,
          stderr: result.stderr,
          termination: outputTruncated ? "output-limit" : result.termination,
        }),
      );
    }
    const stdout = result.stdout.trim();
    if (!parseJson) {
      return { data: stdout, stdout };
    }
    if (!stdout) {
      throw new Error(`Univer Workspace command returned no JSON (${args.slice(0, 3).join(" ")})`);
    }
    try {
      return { data: JSON.parse(stdout) as unknown, stdout };
    } catch {
      throw new Error(`Univer Workspace command returned invalid JSON (${args.slice(0, 3).join(" ")})`);
    }
  };
}

function assertInsideWorkspace(workspaceRoot: string, targetPath: string): void {
  const relative = path.relative(workspaceRoot, targetPath);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    return;
  }
  throw new Error(`Path must stay inside the active OpenClaw workspace: ${targetPath}`);
}

async function nearestExistingAncestor(targetPath: string): Promise<string> {
  let current = targetPath;
  while (true) {
    try {
      await stat(current);
      return current;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
      if (code !== "ENOENT") {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`Cannot resolve output path ancestor: ${targetPath}`);
      }
      current = parent;
    }
  }
}

export async function resolveWorkspaceInputPath(
  workspaceDir: string,
  inputPath: string,
): Promise<string> {
  const workspaceRoot = await realpath(workspaceDir);
  const targetPath = await realpath(path.resolve(workspaceRoot, inputPath));
  assertInsideWorkspace(workspaceRoot, targetPath);
  return targetPath;
}

export async function resolveWorkspaceOutputPath(
  workspaceDir: string,
  outputPath: string,
): Promise<string> {
  const workspaceRoot = await realpath(workspaceDir);
  const targetPath = path.resolve(workspaceRoot, outputPath);
  assertInsideWorkspace(workspaceRoot, targetPath);
  const ancestor = await nearestExistingAncestor(targetPath);
  const realAncestor = await realpath(ancestor);
  assertInsideWorkspace(workspaceRoot, realAncestor);
  return targetPath;
}
