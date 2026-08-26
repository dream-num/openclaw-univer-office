import process from "node:process";
import entry from "../dist/index.js";

let toolFactory;
const api = {
  pluginConfig: process.env.UNIVER_WORKSPACE_CLI
    ? { cliPath: process.env.UNIVER_WORKSPACE_CLI }
    : {},
  registerTool(factory) {
    toolFactory = factory;
  },
  on() {},
};

entry.register(api);
if (typeof toolFactory !== "function") {
  throw new Error("Univer Office did not register its tool factory");
}

const tools = toolFactory({ workspaceDir: process.cwd() });
const byName = new Map(tools.map((tool) => [tool.name, tool]));
const connect = byName.get("univer_office_connect");
const files = byName.get("univer_office_files");
const content = byName.get("univer_office_content");
if (!connect || !files || !content) {
  throw new Error("Required Univer Office smoke-test tools are unavailable");
}

const status = await connect.execute("live-status", { action: "status" });
const spaces = await connect.execute("live-spaces", { action: "list_spaces" });
const statusResult = status.details?.result;
const spacesResult = spaces.details?.result;
if (!statusResult || !spacesResult) {
  throw new Error("Univer Workspace did not return status and Space data");
}

const spaceList = Array.isArray(spacesResult)
  ? spacesResult
  : Array.isArray(spacesResult.spaces)
    ? spacesResult.spaces
    : Array.isArray(spacesResult.data)
      ? spacesResult.data
      : [];
const firstSpace = spaceList[0];
const firstSpaceId = firstSpace && typeof firstSpace === "object"
  ? firstSpace.id ?? firstSpace.spaceId
  : undefined;
if (typeof firstSpaceId !== "string" || !firstSpaceId) {
  throw new Error("Univer Workspace returned no browseable Space identity");
}
const browse = await files.execute("live-browse", {
  action: "browse",
  space_id: firstSpaceId,
});
const guidance = await content.execute("live-guidance", {
  action: "guidance",
  skill: "core",
});
if (!browse.details?.result || !guidance.details?.text?.includes("Worktree")) {
  throw new Error("File browsing or version-matched guidance failed");
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    registeredTools: tools.map((tool) => tool.name),
    authenticated: true,
    accessibleSpaces: spaceList.length,
    browsedSpace: true,
    loadedGuidance: true,
  })}\n`,
);
