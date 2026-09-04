import type { AnyAgentTool, OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { type UniverCliRunner, type UniverOfficeConfig } from "./cli.js";
export declare const UNIVER_OFFICE_TOOL_NAMES: readonly ["univer_office_connect", "univer_office_files", "univer_office_worktree", "univer_office_content", "univer_office_handoff"];
type ToolDependencies = {
    config: UniverOfficeConfig;
    context: OpenClawPluginToolContext;
    runner: UniverCliRunner;
};
export declare function createUniverOfficeTools(dependencies: ToolDependencies): AnyAgentTool[];
export {};
