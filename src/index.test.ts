import { describe, expect, it, vi } from "vitest";
import entry from "./index.js";

describe("univer-office plugin", () => {
  it("registers all tools through one runtime factory", () => {
    const registerTool = vi.fn();
    const on = vi.fn();
    entry.register!({ pluginConfig: {}, registerTool, on } as never);
    expect(registerTool).toHaveBeenCalledWith(expect.any(Function), {
      names: [
        "univer_office_connect",
        "univer_office_files",
        "univer_office_worktree",
        "univer_office_content",
        "univer_office_handoff",
      ],
    });
  });

  it.each([
    ["univer_office_connect", { action: "complete_login" }, "Complete Univer Workspace sign-in"],
    [
      "univer_office_worktree",
      { action: "merge", worktree_id: "wt-merge" },
      "Merge Univer Office draft",
    ],
    [
      "univer_office_worktree",
      { action: "discard", worktree_id: "wt-discard" },
      "Discard Univer Office draft",
    ],
  ])("requires approval for %s", (toolName, params, title) => {
    const on = vi.fn();
    entry.register!({ pluginConfig: {}, registerTool: vi.fn(), on } as never);
    const hook = on.mock.calls.find(([name]) => name === "before_tool_call")?.[1];
    expect(hook).toBeTypeOf("function");
    expect(hook({ toolName, params })).toMatchObject({
      requireApproval: {
        title,
        allowedDecisions: ["allow-once", "deny"],
      },
    });
  });

  it("does not approval-gate isolated draft edits", () => {
    const on = vi.fn();
    entry.register!({ pluginConfig: {}, registerTool: vi.fn(), on } as never);
    const hook = on.mock.calls.find(([name]) => name === "before_tool_call")?.[1];
    expect(
      hook({
        toolName: "univer_office_content",
        params: { action: "execute", worktree_id: "wt-1" },
      }),
    ).toBeUndefined();
  });
});
