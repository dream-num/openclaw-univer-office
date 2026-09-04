import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { get } from "node:http";
import path from "node:path";
import type {
  OpenClawPluginService,
  OpenClawPluginServiceContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { runCommandWithTimeout } from "openclaw/plugin-sdk/process-runtime";
import type { SelfHostedWorkspaceConfig } from "./cli.js";

const STARTUP_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;

function workspaceOrigin(config: SelfHostedWorkspaceConfig): string {
  const host = config.host === "0.0.0.0" || config.host === "::"
    ? "127.0.0.1"
    : config.host;
  return `http://${host.includes(":") ? `[${host}]` : host}:${config.port}`;
}

async function requireFile(filePath: string, label: string): Promise<void> {
  const info = await stat(filePath).catch(() => undefined);
  if (!info?.isFile()) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
}

async function waitForReady(child: ChildProcess, origin: string): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Self-hosted Univer Workspace exited before startup (code=${child.exitCode ?? "none"}, signal=${child.signalCode ?? "none"})`,
      );
    }
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const request = get(origin, (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        request.setTimeout(1_000, () => request.destroy(new Error("probe timeout")));
        request.once("error", reject);
      });
      if ((status >= 200 && status < 300) || status === 302) {
        return;
      }
    } catch {
      // The server may not have bound its socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Self-hosted Univer Workspace did not become ready at ${origin}`);
}

function forwardLogs(
  child: ChildProcess,
  context: OpenClawPluginServiceContext,
): void {
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    const message = chunk.trim();
    if (message) context.logger.info(`[univer-workspace] ${message}`);
  });
  child.stderr?.on("data", (chunk: string) => {
    const message = chunk.trim();
    if (message) context.logger.warn(`[univer-workspace] ${message}`);
  });
}

async function waitForSpawnReady(child: ChildProcess, origin: string): Promise<void> {
  let rejectSpawn: ((error: Error) => void) | undefined;
  const spawnFailure = new Promise<never>((_resolve, reject) => {
    rejectSpawn = reject;
  });
  const onError = (error: Error) => rejectSpawn?.(error);
  child.once("error", onError);
  try {
    await Promise.race([waitForReady(child, origin), spawnFailure]);
  } finally {
    child.off("error", onError);
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, STOP_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function createSelfHostedWorkspaceService(
  config: SelfHostedWorkspaceConfig,
  cliPath: string,
): OpenClawPluginService {
  let child: ChildProcess | undefined;

  return {
    id: "univer-workspace",
    async start(context) {
      const workspaceRoot = await realpath(config.workspaceRoot);
      const serverEntry = path.join(workspaceRoot, "dist", "server", "main.js");
      const publicEntry = path.join(workspaceRoot, "dist", "public", "index.html");
      await requireFile(config.nodePath, "selfHosted.nodePath");
      await requireFile(serverEntry, "Built Univer Workspace server");
      await requireFile(publicEntry, "Built Univer Workspace web app");

      const dataDir = config.dataDir ?? path.join(context.stateDir, "univer-office", "workspace");
      const blobDirectory = path.join(dataDir, "blobs");
      await mkdir(blobDirectory, { recursive: true });

      const origin = workspaceOrigin(config);
      const spawned = spawn(config.nodePath, [serverEntry], {
        cwd: workspaceRoot,
        env: {
          HOST: config.host,
          PORT: String(config.port),
          NODE_ENV: "production",
          SECURE_COOKIES: "true",
          DATABASE_FILE: path.join(dataDir, "workspace.sqlite"),
          COLLABORATION_DATABASE_FILE: path.join(dataDir, "collaboration.sqlite"),
          BLOB_DIRECTORY: blobDirectory,
          ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
          ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
          ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child = spawned;
      forwardLogs(spawned, context);

      try {
        await waitForSpawnReady(spawned, origin);
        const configured = await runCommandWithTimeout(
          [cliPath, "config", "set", "workspace.origin", origin],
          {
            timeoutMs: 30_000,
            killProcessTree: true,
            maxOutputBytes: 64 * 1024,
          },
        );
        if (configured.termination !== "exit" || configured.code !== 0) {
          throw new Error(
            `Could not configure Univer Workspace CLI for ${origin}: ${configured.stderr.trim() || configured.termination}`,
          );
        }
      } catch (error) {
        await stopChild(spawned);
        child = undefined;
        throw error;
      }
      context.logger.info(`Self-hosted Univer Workspace is ready at ${origin}`);
    },
    async stop() {
      const active = child;
      child = undefined;
      if (!active || active.exitCode !== null || active.signalCode !== null) {
        return;
      }
      await stopChild(active);
    },
  };
}
