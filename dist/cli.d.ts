export type UniverOfficeConfig = {
    cliPath: string;
    commandTimeoutMs: number;
    maxOutputBytes: number;
    screenshotMaxImages: number;
    viewerUrl?: string;
    selfHosted?: SelfHostedWorkspaceConfig;
};
export type SelfHostedWorkspaceConfig = {
    workspaceRoot: string;
    nodePath: string;
    host: string;
    port: number;
    dataDir?: string;
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
export declare function parseUniverOfficeConfig(value: unknown): UniverOfficeConfig;
export declare function createUniverCliRunner(config: UniverOfficeConfig): UniverCliRunner;
export declare function resolveWorkspaceInputPath(workspaceDir: string, inputPath: string): Promise<string>;
export declare function resolveWorkspaceOutputPath(workspaceDir: string, outputPath: string): Promise<string>;
