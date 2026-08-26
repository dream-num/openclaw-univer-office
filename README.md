# Univer Office for OpenClaw

Give every OpenClaw a real office where its work can be inspected, edited, approved, and delivered.

`@dream-num/openclaw-univer-office` connects OpenClaw to Univer Workspace. Agents can discover a
user's personal and team Office files, create isolated task Worktrees, edit Sheet/Doc/Slide/Base/
Board Units through the exact Univer Facade API, verify structure and layout, and hand a mobile- and
desktop-friendly review URL back to the user.

## Why this shape

- OpenClaw owns conversation, channels, approvals, and delivery.
- Univer Workspace owns Office content, collaboration, isolated drafts, and human review.
- `ready` never changes the current file. Merge and discard require an explicit user request plus
  OpenClaw's native plugin approval.
- External delivery remains separate from content merge approval and uses OpenClaw's normal
  message/file surface.
- The full editor stays in Univer Workspace; chat surfaces receive progress, PNG previews, status,
  links, and exported files.

## Requirements

- Node.js `>=22.22.3`
- OpenClaw `>=2026.5.17`
- `univer-workspace-cli` available on the Gateway host
- Access to a Univer Workspace deployment

Install the Workspace CLI used by DreamNum deployments:

```bash
npm install -g univer-workspace-cli --registry=https://insider-npm-registry.univer.work/
univer-workspace-cli doctor
```

The CLI defaults to `https://workspace.univer.plus/`. Configure another deployment only when needed:

```bash
univer-workspace-cli config set workspace.origin https://workspace.example.com
```

## Install the private GitHub plugin

Authenticate Git for the private `dream-num` organization, then install from the repository:

```bash
openclaw plugins install git:github.com/dream-num/openclaw-univer-office@main
```

Enable the plugin and its tools:

```json5
{
  plugins: {
    entries: {
      "univer-office": { enabled: true },
    },
  },
  tools: {
    allow: ["univer-office"],
  },
}
```

If the CLI is not on the Gateway process `PATH`, configure an absolute binary path:

```json5
{
  plugins: {
    entries: {
      "univer-office": {
        enabled: true,
        config: {
          cliPath: "/opt/univer/bin/univer-workspace-cli",
        },
      },
    },
  },
}
```

Restart the Gateway after installation or configuration changes.

## Sign in

Ask OpenClaw to connect to Univer Workspace. The plugin starts the CLI's browser approval flow and
returns a verification URL and code. Open that URL on phone or PC, approve it, then tell OpenClaw
you are done. The completion call is separately approval-gated and is never polled.

## Typical request

> Find my Q2 sales workbook, create a private task draft, add a management dashboard, verify the
> formulas and layout, then send me a review link. Do not merge until I approve it.

The expected lifecycle is:

```text
discover file -> create Worktree -> stage Unit -> edit -> inspect -> screenshot
              -> ready -> phone/PC review -> reopen or merge/discard
```

## Tools

| Tool | Purpose |
| --- | --- |
| `univer_office_connect` | Sign-in status, browser approval, and Space listing |
| `univer_office_files` | Find and browse personal/team Space files |
| `univer_office_worktree` | Create/stage/import Units and manage review lifecycle |
| `univer_office_content` | Load guidance, inspect APIs, edit, inspect, and lint |
| `univer_office_handoff` | Generate model-visible PNGs or export/send Office files |

All local import, screenshot, and export paths are constrained to the active OpenClaw workspace.
The plugin invokes the CLI with an argument vector rather than a shell command.

## Plugin approvals

OpenClaw prompts before:

- completing a pending Univer browser sign-in;
- merging a Worktree into the current file;
- discarding an unmerged Worktree;

Screenshot and export tools return workspace-local paths. If the user asks to receive a file, the
agent sends that path through OpenClaw's normal message/file delivery surface, where channel policy
and approvals remain authoritative.

To forward plugin approvals to supported chat channels, configure OpenClaw's `approvals.plugin`
route. Local Control UI approvals work without mixing them with Univer's own Review/Ready state.

## Development

```bash
npm install
npm run check
```

Run the read-only live smoke test against the currently authenticated Workspace CLI:

```bash
npm run build
npm run test:live
```

For a package-shape smoke test:

```bash
npm pack --pack-destination /tmp
openclaw plugins install npm-pack:/tmp/dream-num-openclaw-univer-office-0.1.0.tgz --force
openclaw plugins inspect univer-office --runtime --json
```

## License

Apache-2.0
