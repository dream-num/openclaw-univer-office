import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseUniverOfficeConfig,
  resolveWorkspaceInputPath,
  resolveWorkspaceOutputPath,
} from "./cli.js";

describe("parseUniverOfficeConfig", () => {
  it("uses bounded defaults for missing or invalid values", () => {
    expect(parseUniverOfficeConfig({ commandTimeoutMs: -1, maxOutputBytes: "large" })).toEqual({
      cliPath: "univer-workspace-cli",
      commandTimeoutMs: 120_000,
      maxOutputBytes: 2 * 1024 * 1024,
      screenshotMaxImages: 12,
    });
  });

  it("accepts explicit supported values", () => {
    expect(
      parseUniverOfficeConfig({
        cliPath: "/opt/univer/bin/univer-workspace-cli",
        commandTimeoutMs: 180_000,
        maxOutputBytes: 4_000_000,
        screenshotMaxImages: 20,
        viewerUrl: "https://office.example.com",
      }),
    ).toEqual({
      cliPath: "/opt/univer/bin/univer-workspace-cli",
      commandTimeoutMs: 180_000,
      maxOutputBytes: 4_000_000,
      screenshotMaxImages: 20,
      viewerUrl: "https://office.example.com",
    });
  });

  it("accepts a complete self-hosted Workspace companion", () => {
    expect(
      parseUniverOfficeConfig({
        viewerUrl: "https://office.example.com",
        selfHosted: {
          workspaceRoot: "/srv/univer-workspace/apps/workspace",
          nodePath: "/opt/node-24/bin/node",
          port: 3017,
          dataDir: "/var/lib/univer-workspace",
        },
      }),
    ).toMatchObject({
      viewerUrl: "https://office.example.com",
      selfHosted: {
        workspaceRoot: "/srv/univer-workspace/apps/workspace",
        nodePath: "/opt/node-24/bin/node",
        host: "127.0.0.1",
        port: 3017,
        dataDir: "/var/lib/univer-workspace",
      },
    });
  });

  it("rejects relative self-hosted executable and application paths", () => {
    expect(() =>
      parseUniverOfficeConfig({
        selfHosted: { workspaceRoot: "apps/workspace", nodePath: "node" },
      }),
    ).toThrow(/absolute path/);
  });

  it.each([
    [{ selfHosted: "local" }, /selfHosted must be an object/],
    [
      {
        selfHosted: {
          workspaceRoot: "/srv/univer-workspace/apps/workspace",
          nodePath: "node",
        },
      },
      /selfHosted.nodePath must be an absolute path/,
    ],
  ])("rejects malformed self-hosted config %#", (config, message) => {
    expect(() => parseUniverOfficeConfig(config)).toThrow(message);
  });

  it("normalizes an explicit host and invalid port to supported values", () => {
    expect(
      parseUniverOfficeConfig({
        selfHosted: {
          workspaceRoot: "/srv/univer-workspace/apps/workspace/../workspace",
          nodePath: "/opt/node-24/bin/node",
          host: " 0.0.0.0 ",
          port: 70_000,
        },
      }).selfHosted,
    ).toEqual({
      workspaceRoot: "/srv/univer-workspace/apps/workspace",
      nodePath: "/opt/node-24/bin/node",
      host: "0.0.0.0",
      port: 3_017,
    });
  });

  it.each([
    "workspace.example.com",
    "file:///tmp/workspace",
    "https://user:secret@workspace.example.com",
  ])("rejects unsafe viewer URL %s", (viewerUrl) => {
    expect(() => parseUniverOfficeConfig({ viewerUrl })).toThrow(/viewerUrl/);
  });
});

describe("workspace paths", () => {
  it("resolves existing inputs and new outputs inside the workspace", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "univer-office-paths-"));
    const canonicalWorkspace = await realpath(workspace);
    await mkdir(path.join(workspace, "imports"));
    await writeFile(path.join(workspace, "imports", "input.xlsx"), "fixture");

    await expect(resolveWorkspaceInputPath(workspace, "imports/input.xlsx")).resolves.toBe(
      path.join(canonicalWorkspace, "imports", "input.xlsx"),
    );
    await expect(resolveWorkspaceOutputPath(workspace, "exports/result.xlsx")).resolves.toBe(
      path.join(canonicalWorkspace, "exports", "result.xlsx"),
    );
  });

  it("rejects lexical and symlink escapes", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "univer-office-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "univer-office-outside-"));
    await writeFile(path.join(outside, "secret.xlsx"), "fixture");
    await symlink(outside, path.join(workspace, "escape"));

    await expect(resolveWorkspaceOutputPath(workspace, "../outside.xlsx")).rejects.toThrow(
      "must stay inside",
    );
    await expect(resolveWorkspaceInputPath(workspace, "escape/secret.xlsx")).rejects.toThrow(
      "must stay inside",
    );
    await expect(resolveWorkspaceOutputPath(workspace, "escape/result.xlsx")).rejects.toThrow(
      "must stay inside",
    );
  });
});
