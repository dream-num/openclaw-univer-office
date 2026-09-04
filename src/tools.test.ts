import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AnyAgentTool, OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { describe, expect, it, vi } from "vitest";
import type { UniverCliInvocation, UniverCliRunner, UniverOfficeConfig } from "./cli.js";
import { createUniverOfficeTools, UNIVER_OFFICE_TOOL_NAMES } from "./tools.js";

const config: UniverOfficeConfig = {
  cliPath: "univer-workspace-cli",
  commandTimeoutMs: 120_000,
  maxOutputBytes: 2 * 1024 * 1024,
  screenshotMaxImages: 12,
  viewerUrl: "https://office.example.com",
};

function findTool(tools: AnyAgentTool[], name: string): AnyAgentTool {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`missing tool ${name}`);
  }
  return tool;
}

function createHarness(workspaceDir: string, implementation?: UniverCliRunner) {
  const runner = vi.fn<UniverCliRunner>(
    implementation ??
      (async (invocation) => ({
        data: { args: invocation.args },
        stdout: JSON.stringify({ args: invocation.args }),
      })),
  );
  const tools = createUniverOfficeTools({
    config,
    context: { workspaceDir } as OpenClawPluginToolContext,
    runner,
  });
  return { runner, tools };
}

async function execute(tool: AnyAgentTool, params: Record<string, unknown>) {
  return await tool.execute("call-1", params);
}

describe("Univer Office tools", () => {
  it("registers the stable tool contract", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "univer-office-tools-"));
    const { tools } = createHarness(workspace);
    expect(tools.map((tool) => tool.name)).toEqual(UNIVER_OFFICE_TOOL_NAMES);
  });

  it("returns the browser-login stop instruction", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "univer-office-login-"));
    const { tools } = createHarness(workspace);
    const result = await execute(findTool(tools, "univer_office_connect"), {
      action: "start_login",
    });
    expect(result.details).toMatchObject({
      command: "connect.start_login",
      guidance: expect.stringContaining("stop"),
    });
  });

  it("builds stable file discovery arguments", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "univer-office-files-"));
    const { runner, tools } = createHarness(workspace);
    await execute(findTool(tools, "univer_office_files"), {
      action: "find",
      query: ["Q2", "sales"],
      space_id: "space-1",
      resource_kind: "univer",
      unit_type: "sheet",
    });
    expect(runner).toHaveBeenCalledWith({
      args: [
        "space",
        "find",
        "Q2",
        "sales",
        "--space",
        "space-1",
        "--resource-kind",
        "univer",
        "--unit-type",
        "sheet",
        "--json",
      ],
      cwd: workspace,
      signal: undefined,
    });
  });

  it("uses the configured public viewer URL for collaboration links", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "univer-office-review-"));
    const { runner, tools } = createHarness(workspace);
    const result = await execute(findTool(tools, "univer_office_worktree"), {
      action: "review_url",
      worktree_id: "wt-1",
      unit_id: "unit-1",
    });
    expect(runner).toHaveBeenCalledWith({
      args: [
        "open",
        "--worktree",
        "wt-1",
        "--unit",
        "unit-1",
        "--viewer-url",
        "https://office.example.com",
        "--json",
      ],
      cwd: workspace,
      signal: undefined,
    });
    expect(result.details).toMatchObject({
      guidance: expect.stringContaining("complete Univer Workspace /worktrees experience"),
    });
    expect(result.details).toMatchObject({
      guidance: expect.stringContaining("does not grant access by itself"),
    });
  });

  it("can expose an existing Team Space Worktree after approval", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "univer-office-visibility-"));
    const { runner, tools } = createHarness(workspace);
    await execute(findTool(tools, "univer_office_worktree"), {
      action: "set_visibility",
      worktree_id: "wt-1",
      visibility: "space",
    });
    expect(runner).toHaveBeenCalledWith({
      args: [
        "worktree",
        "update",
        "wt-1",
        "--visibility",
        "space",
        "--json",
      ],
      cwd: workspace,
      signal: undefined,
    });
  });

  it("rejects Space visibility on a user-scoped Worktree", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "univer-office-scope-"));
    const { runner, tools } = createHarness(workspace);
    await expect(
      execute(findTool(tools, "univer_office_worktree"), {
        action: "create",
        name: "Private task",
        scope: "user",
        visibility: "space",
      }),
    ).rejects.toThrow("visibility space requires scope space");
    expect(runner).not.toHaveBeenCalled();
  });

  it("resolves imports inside the active workspace", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "univer-office-import-"));
    const canonicalWorkspace = await realpath(workspace);
    await mkdir(path.join(workspace, "incoming"));
    const source = path.join(canonicalWorkspace, "incoming", "report.docx");
    await writeFile(source, "fixture");
    const { runner, tools } = createHarness(workspace);
    await execute(findTool(tools, "univer_office_worktree"), {
      action: "import",
      worktree_id: "wt-1",
      space_id: "space-1",
      source_path: "incoming/report.docx",
      unit_type: "doc",
      name: "Report",
    });
    expect(runner.mock.calls[0]?.[0].args).toEqual([
      "import",
      "--file",
      source,
      "--worktree",
      "wt-1",
      "--space",
      "space-1",
      "--type",
      "doc",
      "--name",
      "Report",
      "--json",
    ]);
  });

  it("passes Facade code without shell interpolation", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "univer-office-execute-"));
    const { runner, tools } = createHarness(workspace);
    const code = "workbook.getActiveSheet().getRange('A1').setValue('$HOME; $(whoami)')";
    await execute(findTool(tools, "univer_office_content"), {
      action: "execute",
      worktree_id: "wt-1",
      unit_id: "unit-1",
      code,
    });
    expect(runner.mock.calls[0]?.[0].args).toEqual([
      "execute",
      "--worktree",
      "wt-1",
      "--unit",
      "unit-1",
      "--code",
      code,
      "--json",
    ]);
  });

  it("returns screenshot PNGs as model-visible image blocks", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "univer-office-shot-"));
    const canonicalWorkspace = await realpath(workspace);
    const outputDirectory = path.join(canonicalWorkspace, "screenshots");
    const imagePath = path.join(outputDirectory, "page-1.png");
    const runner = async (invocation: UniverCliInvocation) => {
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(imagePath, Buffer.from("89504e47", "hex"));
      return {
        data: { files: [imagePath], args: invocation.args },
        stdout: JSON.stringify({ files: [imagePath] }),
      };
    };
    const harness = createHarness(workspace, runner);
    const result = await execute(findTool(harness.tools, "univer_office_handoff"), {
      action: "screenshot",
      worktree_id: "wt-1",
      unit_id: "unit-1",
      output_path: "screenshots",
    });
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "image", mimeType: "image/png" }),
      ]),
    );
    expect(result.details).toMatchObject({ paths: [imagePath] });
  });
});
