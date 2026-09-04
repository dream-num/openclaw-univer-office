import { definePluginEntry, } from "openclaw/plugin-sdk/plugin-entry";
import { createUniverCliRunner, parseUniverOfficeConfig } from "./cli.js";
import { createUniverOfficeTools, UNIVER_OFFICE_TOOL_NAMES } from "./tools.js";
import { createSelfHostedWorkspaceService } from "./workspace-service.js";
function readAction(params) {
    const value = params.action;
    return typeof value === "string" ? value.trim() : undefined;
}
function readBoundedLabel(params, key) {
    const value = params[key];
    if (typeof value !== "string" || !value.trim()) {
        return "unknown";
    }
    return value.trim().slice(0, 160);
}
const univerOfficePlugin = definePluginEntry({
    id: "univer-office",
    name: "Univer Office",
    description: "Create, edit, inspect, review, approve, and deliver Office artifacts through Univer Workspace.",
    register(api) {
        const config = parseUniverOfficeConfig(api.pluginConfig);
        const runner = createUniverCliRunner(config);
        if (config.selfHosted) {
            api.registerService(createSelfHostedWorkspaceService(config.selfHosted, config.cliPath));
        }
        api.registerTool((context) => createUniverOfficeTools({ config, context, runner }), { names: [...UNIVER_OFFICE_TOOL_NAMES] });
        api.on("before_tool_call", (event) => {
            const action = readAction(event.params);
            if (event.toolName === "univer_office_connect" && action === "complete_login") {
                return {
                    requireApproval: {
                        title: "Complete Univer Workspace sign-in",
                        description: "Complete the pending browser sign-in. Approve only after you finished the Univer verification page.",
                        severity: "info",
                        allowedDecisions: ["allow-once", "deny"],
                    },
                };
            }
            if (event.toolName === "univer_office_worktree" && action === "merge") {
                return {
                    requireApproval: {
                        title: "Merge Univer Office draft",
                        description: `Merge Worktree ${readBoundedLabel(event.params, "worktree_id")} into the current file version.`,
                        severity: "warning",
                        allowedDecisions: ["allow-once", "deny"],
                    },
                };
            }
            if (event.toolName === "univer_office_worktree" &&
                ((action === "create" && event.params.scope === "space") ||
                    action === "set_visibility") &&
                event.params.visibility === "space") {
                return {
                    requireApproval: {
                        title: "Share Univer Office draft with Team Space",
                        description: action === "create"
                            ? "Allow members of the selected Team Space to see the new Worktree."
                            : `Allow members of the selected Team Space to see Worktree ${readBoundedLabel(event.params, "worktree_id")}.`,
                        severity: "warning",
                        allowedDecisions: ["allow-once", "deny"],
                    },
                };
            }
            if (event.toolName === "univer_office_worktree" && action === "discard") {
                return {
                    requireApproval: {
                        title: "Discard Univer Office draft",
                        description: `Permanently discard Worktree ${readBoundedLabel(event.params, "worktree_id")} and its unmerged changes.`,
                        severity: "critical",
                        allowedDecisions: ["allow-once", "deny"],
                    },
                };
            }
            return undefined;
        });
    },
});
export default univerOfficePlugin;
