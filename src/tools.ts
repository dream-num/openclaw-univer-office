import { readFile } from "node:fs/promises";
import type {
  AnyAgentTool,
  OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";
import {
  type UniverCliOutput,
  type UniverCliRunner,
  type UniverOfficeConfig,
  resolveWorkspaceInputPath,
  resolveWorkspaceOutputPath,
} from "./cli.js";

export const UNIVER_OFFICE_TOOL_NAMES = [
  "univer_office_connect",
  "univer_office_files",
  "univer_office_worktree",
  "univer_office_content",
  "univer_office_handoff",
] as const;

type ToolParams = Record<string, unknown>;

type ToolDependencies = {
  config: UniverOfficeConfig;
  context: OpenClawPluginToolContext;
  runner: UniverCliRunner;
};

function requiredString(params: ToolParams, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function optionalString(params: ToolParams, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(params: ToolParams, key: string): boolean | undefined {
  const value = params[key];
  return typeof value === "boolean" ? value : undefined;
}

function optionalNumber(params: ToolParams, key: string): number | undefined {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requiredStrings(params: ToolParams, key: string): string[] {
  const value = params[key];
  if (!Array.isArray(value)) {
    throw new Error(`${key} is required`);
  }
  const strings = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (strings.length === 0) {
    throw new Error(`${key} is required`);
  }
  return strings;
}

function appendOption(args: string[], flag: string, value: string | number | undefined): void {
  if (value !== undefined) {
    args.push(flag, String(value));
  }
}

function jsonToolResult(command: string, output: UniverCliOutput, guidance?: string) {
  const details = {
    ok: true,
    command,
    result: output.data,
    ...(guidance ? { guidance } : {}),
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
    details,
  };
}

function textToolResult(command: string, output: UniverCliOutput) {
  const details = { ok: true, command, text: output.stdout };
  return {
    content: [{ type: "text" as const, text: output.stdout }],
    details,
  };
}

function resolveWorkspaceDir(context: OpenClawPluginToolContext): string {
  if (!context.workspaceDir) {
    throw new Error("Univer Office requires an active OpenClaw workspace directory");
  }
  return context.workspaceDir;
}

function createConnectTool({ context, runner }: ToolDependencies): AnyAgentTool {
  return {
    name: "univer_office_connect",
    label: "Univer Office Connect",
    description:
      "Check Univer Workspace sign-in, start browser approval, complete it only after user confirmation, or list accessible Spaces.",
    parameters: Type.Object(
      {
        action: Type.Enum(["status", "start_login", "complete_login", "list_spaces"], {
          type: "string",
        }),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params: ToolParams, signal?: AbortSignal) {
      const action = requiredString(params, "action");
      const cwd = resolveWorkspaceDir(context);
      const args = action === "status"
        ? ["whoami", "--json"]
        : action === "start_login"
          ? ["login", "--json"]
          : action === "complete_login"
            ? ["login", "--complete", "--json"]
            : action === "list_spaces"
              ? ["space", "list", "--json"]
              : undefined;
      if (!args) {
        throw new Error(`Unknown connect action: ${action}`);
      }
      const output = await runner({ args, cwd, signal });
      const guidance = action === "start_login"
        ? "Show verificationUrl and userCode to the user, then stop. Call complete_login only after the user explicitly confirms approval."
        : undefined;
      return jsonToolResult(`connect.${action}`, output, guidance);
    },
  };
}

function createFilesTool({ context, runner }: ToolDependencies): AnyAgentTool {
  return {
    name: "univer_office_files",
    label: "Univer Office Files",
    description:
      "Discover personal and team Office files by stable Space, Node, Resource, and Unit identity before opening a task Worktree.",
    parameters: Type.Object(
      {
        action: Type.Enum(["list_spaces", "find", "browse"], { type: "string" }),
        query: Type.Optional(Type.Array(Type.String())),
        space_id: Type.Optional(Type.String()),
        parent_node_id: Type.Optional(Type.String()),
        recursive: Type.Optional(Type.Boolean()),
        resource_kind: Type.Optional(
          Type.Enum(["none", "univer", "blob"], { type: "string" }),
        ),
        unit_type: Type.Optional(
          Type.Enum(["sheet", "doc", "slide", "base", "board"], { type: "string" }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params: ToolParams, signal?: AbortSignal) {
      const action = requiredString(params, "action");
      const cwd = resolveWorkspaceDir(context);
      let args: string[];
      if (action === "list_spaces") {
        args = ["space", "list", "--json"];
      } else if (action === "find") {
        args = ["space", "find", ...requiredStrings(params, "query")];
        appendOption(args, "--space", optionalString(params, "space_id"));
        appendOption(args, "--resource-kind", optionalString(params, "resource_kind"));
        appendOption(args, "--unit-type", optionalString(params, "unit_type"));
        args.push("--json");
      } else if (action === "browse") {
        args = ["space", "browse", requiredString(params, "space_id")];
        appendOption(args, "--parent", optionalString(params, "parent_node_id"));
        if (optionalBoolean(params, "recursive")) {
          args.push("--recursive");
        }
        appendOption(args, "--resource-kind", optionalString(params, "resource_kind"));
        appendOption(args, "--unit-type", optionalString(params, "unit_type"));
        args.push("--json");
      } else {
        throw new Error(`Unknown files action: ${action}`);
      }
      return jsonToolResult(`files.${action}`, await runner({ args, cwd, signal }));
    },
  };
}

function requireSpaceForScope(params: ToolParams, scope: string): string | undefined {
  const spaceId = optionalString(params, "space_id");
  if (scope === "space" && !spaceId) {
    throw new Error("space_id is required when scope is space");
  }
  return spaceId;
}

async function buildWorktreeArgs(
  params: ToolParams,
  context: OpenClawPluginToolContext,
  config: UniverOfficeConfig,
): Promise<string[]> {
  const action = requiredString(params, "action");
  const worktreeId = optionalString(params, "worktree_id");
  if (action === "list") {
    const args = ["worktree", "list"];
    appendOption(args, "--view", optionalString(params, "view"));
    appendOption(args, "--scope", optionalString(params, "scope"));
    appendOption(args, "--space", optionalString(params, "space_id"));
    return [...args, "--json"];
  }
  if (action === "get") {
    return ["worktree", "get", requiredString(params, "worktree_id"), "--json"];
  }
  if (action === "list_units") {
    return ["unit", "list", "--worktree", requiredString(params, "worktree_id"), "--json"];
  }
  if (action === "create") {
    const scope = requiredString(params, "scope");
    const spaceId = requireSpaceForScope(params, scope);
    const visibility = optionalString(params, "visibility");
    if (scope !== "space" && visibility === "space") {
      throw new Error("visibility space requires scope space");
    }
    const args = [
      "worktree",
      "create",
      "--name",
      requiredString(params, "name"),
      "--scope",
      scope,
    ];
    appendOption(args, "--space", spaceId);
    appendOption(args, "--visibility", visibility);
    appendOption(args, "--idempotency-key", optionalString(params, "idempotency_key"));
    return [...args, "--json"];
  }
  if (action === "set_visibility") {
    return [
      "worktree",
      "update",
      requiredString(params, "worktree_id"),
      "--visibility",
      requiredString(params, "visibility"),
      "--json",
    ];
  }
  if (action === "stage_resource") {
    return [
      "unit",
      "add",
      "--worktree",
      requiredString(params, "worktree_id"),
      "--resource",
      requiredString(params, "resource_id"),
      "--json",
    ];
  }
  if (action === "create_unit") {
    const args = [
      "unit",
      "create",
      "--worktree",
      requiredString(params, "worktree_id"),
      "--space",
      requiredString(params, "space_id"),
      "--type",
      requiredString(params, "unit_type"),
      "--name",
      requiredString(params, "name"),
    ];
    appendOption(args, "--parent", optionalString(params, "parent_node_id"));
    appendOption(args, "--idempotency-key", optionalString(params, "idempotency_key"));
    return [...args, "--json"];
  }
  if (action === "import") {
    const sourcePath = await resolveWorkspaceInputPath(
      resolveWorkspaceDir(context),
      requiredString(params, "source_path"),
    );
    const args = [
      "import",
      "--file",
      sourcePath,
      "--worktree",
      requiredString(params, "worktree_id"),
      "--space",
      requiredString(params, "space_id"),
    ];
    appendOption(args, "--type", optionalString(params, "unit_type"));
    appendOption(args, "--name", optionalString(params, "name"));
    appendOption(args, "--parent", optionalString(params, "parent_node_id"));
    appendOption(args, "--idempotency-key", optionalString(params, "idempotency_key"));
    return [...args, "--json"];
  }
  if (["ready", "reopen", "merge", "discard"].includes(action)) {
    if (!worktreeId) {
      throw new Error("worktree_id is required");
    }
    return ["worktree", action, worktreeId, "--json"];
  }
  if (action === "review_url") {
    const args = [
      "open",
      "--worktree",
      requiredString(params, "worktree_id"),
      "--unit",
      requiredString(params, "unit_id"),
    ];
    appendOption(args, "--viewer-url", config.viewerUrl);
    return [...args, "--json"];
  }
  throw new Error(`Unknown worktree action: ${action}`);
}

function createWorktreeTool(dependencies: ToolDependencies): AnyAgentTool {
  const { context, runner } = dependencies;
  return {
    name: "univer_office_worktree",
    label: "Univer Office Worktree",
    description:
      "Create an isolated Office task, control Team Space visibility, stage or create a Unit, submit it for review, reopen it, or perform user-approved merge/discard.",
    parameters: Type.Object(
      {
        action: Type.Enum(
          [
            "list",
            "get",
            "list_units",
            "create",
            "set_visibility",
            "stage_resource",
            "create_unit",
            "import",
            "ready",
            "reopen",
            "review_url",
            "merge",
            "discard",
          ],
          { type: "string" },
        ),
        worktree_id: Type.Optional(Type.String()),
        unit_id: Type.Optional(Type.String()),
        resource_id: Type.Optional(Type.String()),
        space_id: Type.Optional(Type.String()),
        parent_node_id: Type.Optional(Type.String()),
        name: Type.Optional(Type.String()),
        scope: Type.Optional(Type.Enum(["user", "space"], { type: "string" })),
        visibility: Type.Optional(Type.Enum(["private", "space"], { type: "string" })),
        view: Type.Optional(Type.Enum(["active", "processed"], { type: "string" })),
        unit_type: Type.Optional(
          Type.Enum(["sheet", "doc", "slide", "base", "board"], { type: "string" }),
        ),
        source_path: Type.Optional(Type.String()),
        idempotency_key: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    async execute(_toolCallId, params: ToolParams, signal?: AbortSignal) {
      const action = requiredString(params, "action");
      const args = await buildWorktreeArgs(params, context, dependencies.config);
      const output = await runner({ args, cwd: resolveWorkspaceDir(context), signal });
      const guidance = action === "ready"
        ? "Read back the ready state, then call review_url and give the URL plus Worktree and Unit ids to the user. Ready does not merge."
        : action === "set_visibility"
          ? "Space visibility lets members of the owning Team Space see this Worktree. It does not create anonymous access."
          : action === "review_url"
            ? "Share this URL with authorized collaborators. It opens the full Univer Workspace on phone or desktop, but the URL does not grant access by itself; collaborators must sign in and have access to the owning Team Space."
            : undefined;
      return jsonToolResult(`worktree.${action}`, output, guidance);
    },
  };
}

function createContentTool({ context, runner }: ToolDependencies): AnyAgentTool {
  return {
    name: "univer_office_content",
    label: "Univer Office Content",
    description:
      "Load version-matched guidance, inspect exact Facade APIs, edit one staged Unit, and verify stored or rendered content.",
    parameters: Type.Object(
      {
        action: Type.Enum(
          ["guidance", "api_find", "api_show", "execute", "inspect", "lint"],
          { type: "string" },
        ),
        skill: Type.Optional(
          Type.Enum(
            ["core", "sheet", "doc", "slide", "base", "board", "embed", "cross-unit-formula"],
            { type: "string" },
          ),
        ),
        full: Type.Optional(Type.Boolean()),
        terms: Type.Optional(Type.Array(Type.String())),
        symbols: Type.Optional(Type.Array(Type.String())),
        api_unit: Type.Optional(Type.Enum(["sheet", "doc", "slide"], { type: "string" })),
        worktree_id: Type.Optional(Type.String()),
        unit_id: Type.Optional(Type.String()),
        code: Type.Optional(Type.String()),
        target: Type.Optional(
          Type.Enum(
            ["workbook", "worksheet", "range", "presentation", "slide", "document", "paragraph"],
            { type: "string" },
          ),
        ),
        selectors: Type.Optional(Type.Array(Type.String())),
        worksheet: Type.Optional(Type.String()),
        trunk: Type.Optional(Type.Boolean()),
        pages: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    async execute(_toolCallId, params: ToolParams, signal?: AbortSignal) {
      const action = requiredString(params, "action");
      const cwd = resolveWorkspaceDir(context);
      if (action === "guidance") {
        const args = ["skills", "get", requiredString(params, "skill")];
        if (optionalBoolean(params, "full")) {
          args.push("--full");
        }
        return textToolResult(`content.${action}`, await runner({ args, cwd, signal, parseJson: false }));
      }
      if (action === "api_find") {
        const args = ["api", "find", ...requiredStrings(params, "terms")];
        appendOption(args, "--unit", optionalString(params, "api_unit"));
        return textToolResult(`content.${action}`, await runner({ args, cwd, signal, parseJson: false }));
      }
      if (action === "api_show") {
        const args = ["api", "show", ...requiredStrings(params, "symbols")];
        return textToolResult(`content.${action}`, await runner({ args, cwd, signal, parseJson: false }));
      }
      if (action === "execute") {
        const args = [
          "execute",
          "--worktree",
          requiredString(params, "worktree_id"),
          "--unit",
          requiredString(params, "unit_id"),
          "--code",
          requiredString(params, "code"),
          "--json",
        ];
        return jsonToolResult(`content.${action}`, await runner({ args, cwd, signal }));
      }
      if (action === "inspect") {
        const args = ["inspect", requiredString(params, "target")];
        const selectors = params.selectors;
        if (Array.isArray(selectors)) {
          args.push(
            ...selectors
              .filter((entry): entry is string => typeof entry === "string")
              .map((entry) => entry.trim())
              .filter(Boolean),
          );
        }
        appendOption(args, "--unit", optionalString(params, "unit_id"));
        appendOption(args, "--worksheet", optionalString(params, "worksheet"));
        if (optionalBoolean(params, "trunk")) {
          args.push("--trunk");
        } else {
          appendOption(args, "--worktree", requiredString(params, "worktree_id"));
        }
        args.push("--json");
        return jsonToolResult(`content.${action}`, await runner({ args, cwd, signal }));
      }
      if (action === "lint") {
        const args = [
          "lint",
          "--worktree",
          requiredString(params, "worktree_id"),
          "--unit",
          requiredString(params, "unit_id"),
        ];
        appendOption(args, "--pages", optionalString(params, "pages"));
        args.push("--json");
        return jsonToolResult(`content.${action}`, await runner({ args, cwd, signal }));
      }
      throw new Error(`Unknown content action: ${action}`);
    },
  };
}

function collectPngPaths(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string" && value.toLowerCase().endsWith(".png")) {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPngPaths(entry, output);
    }
    return output;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectPngPaths(entry, output);
    }
  }
  return output;
}

async function loadScreenshotImages(
  workspaceDir: string,
  data: unknown,
  maximum: number,
): Promise<Array<{ path: string; data: string }>> {
  const paths = [...new Set(collectPngPaths(data))].slice(0, maximum);
  return await Promise.all(
    paths.map(async (filePath) => {
      const resolvedPath = await resolveWorkspaceInputPath(workspaceDir, filePath);
      return { path: resolvedPath, data: (await readFile(resolvedPath)).toString("base64") };
    }),
  );
}

function createHandoffTool({ config, context, runner }: ToolDependencies): AnyAgentTool {
  return {
    name: "univer_office_handoff",
    label: "Univer Office Handoff",
    description:
      "Render model-visible PNG previews or export an Office file inside the active OpenClaw workspace.",
    parameters: Type.Object(
      {
        action: Type.Enum(["screenshot", "export"], { type: "string" }),
        worktree_id: Type.String(),
        unit_id: Type.String(),
        output_path: Type.String({
          description: "Path relative to the active OpenClaw workspace.",
        }),
        pages: Type.Optional(Type.String()),
        contact_slide: Type.Optional(Type.Boolean()),
        tile: Type.Optional(Type.String()),
        sheet: Type.Optional(Type.String()),
        range: Type.Optional(Type.String()),
        region: Type.Optional(Type.String()),
        elements: Type.Optional(Type.String()),
        padding: Type.Optional(Type.Number()),
        scale: Type.Optional(Type.Number()),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    async execute(_toolCallId, params: ToolParams, signal?: AbortSignal) {
      const action = requiredString(params, "action");
      const workspaceDir = resolveWorkspaceDir(context);
      const outputPath = await resolveWorkspaceOutputPath(
        workspaceDir,
        requiredString(params, "output_path"),
      );
      const worktreeId = requiredString(params, "worktree_id");
      const unitId = requiredString(params, "unit_id");
      if (action === "export") {
        const args = [
          "export",
          outputPath,
          "--worktree",
          worktreeId,
          "--unit",
          unitId,
          "--json",
        ];
        const output = await runner({ args, cwd: workspaceDir, signal });
        const details = {
          ok: true,
          command: "handoff.export",
          path: outputPath,
          result: output.data,
          guidance:
            "Use OpenClaw's normal message/file delivery surface if the user asked to receive this export.",
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
          details,
        };
      }
      if (action === "screenshot") {
        const args = [
          "screenshot",
          "--worktree",
          worktreeId,
          "--unit",
          unitId,
          "--out",
          outputPath,
        ];
        appendOption(args, "--pages", optionalString(params, "pages"));
        if (optionalBoolean(params, "contact_slide")) {
          args.push("--contact-slide");
        }
        appendOption(args, "--tile", optionalString(params, "tile"));
        appendOption(args, "--sheet", optionalString(params, "sheet"));
        appendOption(args, "--range", optionalString(params, "range"));
        appendOption(args, "--region", optionalString(params, "region"));
        appendOption(args, "--elements", optionalString(params, "elements"));
        appendOption(args, "--padding", optionalNumber(params, "padding"));
        appendOption(args, "--scale", optionalNumber(params, "scale"));
        args.push("--json");
        const output = await runner({
          args,
          cwd: workspaceDir,
          signal,
          timeoutMs: Math.max(config.commandTimeoutMs, 180_000),
        });
        const images = await loadScreenshotImages(
          workspaceDir,
          output.data,
          config.screenshotMaxImages,
        );
        const paths = images.map((image) => image.path);
        const details = {
          ok: true,
          command: "handoff.screenshot",
          paths,
          result: output.data,
          guidance:
            "The PNGs are visible to the model. Use OpenClaw's normal message/file delivery surface if the user asked to receive them.",
        };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(details, null, 2) },
            ...images.map((image) => ({
              type: "image" as const,
              data: image.data,
              mimeType: "image/png",
            })),
          ],
          details,
        };
      }
      throw new Error(`Unknown handoff action: ${action}`);
    },
  };
}

export function createUniverOfficeTools(dependencies: ToolDependencies): AnyAgentTool[] {
  return [
    createConnectTool(dependencies),
    createFilesTool(dependencies),
    createWorktreeTool(dependencies),
    createContentTool(dependencies),
    createHandoffTool(dependencies),
  ];
}
