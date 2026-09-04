import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  mkdir: vi.fn(),
  realpath: vi.fn(),
  runCommandWithTimeout: vi.fn(),
  spawn: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs/promises", () => ({
  mkdir: mocks.mkdir,
  realpath: mocks.realpath,
  stat: mocks.stat,
}));
vi.mock("node:http", () => ({ get: mocks.get }));
vi.mock("openclaw/plugin-sdk/process-runtime", () => ({
  runCommandWithTimeout: mocks.runCommandWithTimeout,
}));

import { createSelfHostedWorkspaceService } from "./workspace-service.js";

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = vi.fn((signal: NodeJS.Signals) => {
    queueMicrotask(() => {
      this.signalCode = signal;
      this.emit("exit", null, signal);
    });
    return true;
  });
}

function readyResponse(statusCode = 302) {
  mocks.get.mockImplementation((_origin, callback) => {
    const request = new EventEmitter() as EventEmitter & {
      destroy(error?: Error): void;
      setTimeout(timeout: number, callback: () => void): void;
    };
    request.destroy = (error) => {
      if (error) request.emit("error", error);
    };
    request.setTimeout = vi.fn();
    queueMicrotask(() => callback({ statusCode, resume: vi.fn() }));
    return request;
  });
}

function serviceContext() {
  return {
    stateDir: "/state",
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
  };
}

describe("self-hosted Workspace service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.realpath.mockResolvedValue("/real/workspace");
    mocks.stat.mockResolvedValue({ isFile: () => true });
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.runCommandWithTimeout.mockResolvedValue({
      code: 0,
      stderr: "",
      stdout: "",
      termination: "exit",
    });
    readyResponse();
  });

  it("starts the built Workspace with persistent stores and configures the CLI", async () => {
    const child = new FakeChild();
    mocks.spawn.mockReturnValue(child);
    const context = serviceContext();
    const service = createSelfHostedWorkspaceService(
      {
        workspaceRoot: "/configured/workspace",
        nodePath: "/opt/node/bin/node",
        host: "0.0.0.0",
        port: 3_017,
      },
      "/opt/univer/bin/univer-workspace-cli",
    );

    await service.start(context as never);
    child.stdout.write("server ready\n");
    child.stderr.write("server warning\n");

    expect(mocks.mkdir).toHaveBeenCalledWith(
      "/state/univer-office/workspace/blobs",
      { recursive: true },
    );
    expect(mocks.spawn).toHaveBeenCalledWith(
      "/opt/node/bin/node",
      ["/real/workspace/dist/server/main.js"],
      expect.objectContaining({
        cwd: "/real/workspace",
        env: expect.objectContaining({
          BLOB_DIRECTORY: "/state/univer-office/workspace/blobs",
          COLLABORATION_DATABASE_FILE:
            "/state/univer-office/workspace/collaboration.sqlite",
          DATABASE_FILE: "/state/univer-office/workspace/workspace.sqlite",
          HOST: "0.0.0.0",
          PORT: "3017",
          SECURE_COOKIES: "true",
        }),
      }),
    );
    expect(mocks.get).toHaveBeenCalledWith(
      "http://127.0.0.1:3017",
      expect.any(Function),
    );
    expect(mocks.runCommandWithTimeout).toHaveBeenCalledWith(
      [
        "/opt/univer/bin/univer-workspace-cli",
        "config",
        "set",
        "workspace.origin",
        "http://127.0.0.1:3017",
      ],
      expect.objectContaining({ timeoutMs: 30_000 }),
    );
    expect(context.logger.info).toHaveBeenCalledWith(
      "[univer-workspace] server ready",
    );
    expect(context.logger.warn).toHaveBeenCalledWith(
      "[univer-workspace] server warning",
    );

    await service.stop?.(context as never);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("uses an explicit data directory", async () => {
    mocks.spawn.mockReturnValue(new FakeChild());
    const service = createSelfHostedWorkspaceService(
      {
        workspaceRoot: "/configured/workspace",
        nodePath: "/opt/node/bin/node",
        host: "127.0.0.1",
        port: 3_017,
        dataDir: "/var/lib/univer-workspace",
      },
      "univer-workspace-cli",
    );

    await service.start(serviceContext() as never);

    expect(mocks.mkdir).toHaveBeenCalledWith(
      "/var/lib/univer-workspace/blobs",
      { recursive: true },
    );
    expect(mocks.spawn).toHaveBeenCalledWith(
      "/opt/node/bin/node",
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          DATABASE_FILE: "/var/lib/univer-workspace/workspace.sqlite",
        }),
      }),
    );
  });

  it("brackets an IPv6 host in the CLI origin", async () => {
    mocks.spawn.mockReturnValue(new FakeChild());
    const service = createSelfHostedWorkspaceService(
      {
        workspaceRoot: "/configured/workspace",
        nodePath: "/opt/node/bin/node",
        host: "::1",
        port: 3_017,
      },
      "univer-workspace-cli",
    );

    await service.start(serviceContext() as never);

    expect(mocks.get).toHaveBeenCalledWith(
      "http://[::1]:3017",
      expect.any(Function),
    );
    expect(mocks.runCommandWithTimeout).toHaveBeenCalledWith(
      [
        "univer-workspace-cli",
        "config",
        "set",
        "workspace.origin",
        "http://[::1]:3017",
      ],
      expect.any(Object),
    );
  });

  it("retries a transient readiness failure", async () => {
    vi.useFakeTimers();
    try {
      mocks.spawn.mockReturnValue(new FakeChild());
      let attempt = 0;
      mocks.get.mockImplementation((_origin, callback) => {
        const request = new EventEmitter() as EventEmitter & {
          destroy(error?: Error): void;
          setTimeout(timeout: number, callback: () => void): void;
        };
        request.destroy = (error) => {
          if (error) request.emit("error", error);
        };
        request.setTimeout = vi.fn();
        queueMicrotask(() => {
          attempt += 1;
          callback({ statusCode: attempt === 1 ? 503 : 200, resume: vi.fn() });
        });
        return request;
      });
      const service = createSelfHostedWorkspaceService(
        {
          workspaceRoot: "/configured/workspace",
          nodePath: "/opt/node/bin/node",
          host: "127.0.0.1",
          port: 3_017,
        },
        "univer-workspace-cli",
      );

      const started = service.start(serviceContext() as never);
      await vi.runAllTimersAsync();
      await started;

      expect(mocks.get).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails before spawning when a built artifact is missing", async () => {
    mocks.stat.mockImplementation(async (filePath: string) => ({
      isFile: () => !filePath.endsWith("dist/server/main.js"),
    }));
    const service = createSelfHostedWorkspaceService(
      {
        workspaceRoot: "/configured/workspace",
        nodePath: "/opt/node/bin/node",
        host: "127.0.0.1",
        port: 3_017,
      },
      "univer-workspace-cli",
    );

    await expect(service.start(serviceContext() as never)).rejects.toThrow(
      "Built Univer Workspace server is missing",
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("stops the child when CLI configuration fails", async () => {
    const child = new FakeChild();
    mocks.spawn.mockReturnValue(child);
    mocks.runCommandWithTimeout.mockResolvedValue({
      code: 1,
      stderr: "configuration failed",
      stdout: "",
      termination: "exit",
    });
    const service = createSelfHostedWorkspaceService(
      {
        workspaceRoot: "/configured/workspace",
        nodePath: "/opt/node/bin/node",
        host: "127.0.0.1",
        port: 3_017,
      },
      "univer-workspace-cli",
    );

    await expect(service.start(serviceContext() as never)).rejects.toThrow(
      "Could not configure Univer Workspace CLI",
    );
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("reports a child that exits before becoming ready", async () => {
    const child = new FakeChild();
    child.exitCode = 1;
    mocks.spawn.mockReturnValue(child);
    const service = createSelfHostedWorkspaceService(
      {
        workspaceRoot: "/configured/workspace",
        nodePath: "/opt/node/bin/node",
        host: "127.0.0.1",
        port: 3_017,
      },
      "univer-workspace-cli",
    );

    await expect(service.start(serviceContext() as never)).rejects.toThrow(
      "exited before startup",
    );
    expect(mocks.runCommandWithTimeout).not.toHaveBeenCalled();
  });

  it("ignores stop before the service has started", async () => {
    const service = createSelfHostedWorkspaceService(
      {
        workspaceRoot: "/configured/workspace",
        nodePath: "/opt/node/bin/node",
        host: "127.0.0.1",
        port: 3_017,
      },
      "univer-workspace-cli",
    );

    await service.stop?.(serviceContext() as never);

    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("forces termination when graceful shutdown does not exit", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      child.kill.mockImplementation(() => true);
      mocks.spawn.mockReturnValue(child);
      const context = serviceContext();
      const service = createSelfHostedWorkspaceService(
        {
          workspaceRoot: "/configured/workspace",
          nodePath: "/opt/node/bin/node",
          host: "127.0.0.1",
          port: 3_017,
        },
        "univer-workspace-cli",
      );
      await service.start(context as never);

      const stopped = service.stop?.(context as never);
      await vi.advanceTimersByTimeAsync(5_000);
      await stopped;

      expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
      expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });
});
