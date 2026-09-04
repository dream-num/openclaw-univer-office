# Univer Office for OpenClaw

Give every OpenClaw a real office where its work can be inspected, edited, approved, and delivered.

`@dream-num/openclaw-univer-office` connects OpenClaw to Univer Workspace. Agents can discover a
user's personal and team Office files, create isolated task Worktrees, edit Sheet/Doc/Slide/Base/
Board Units through the exact Univer Facade API, verify structure and layout, and hand a mobile- and
desktop-friendly review URL back to the user.

Yes, it supports realtime collaboration. OpenClaw and the plugin can run on your Mac while you
share one Univer Workspace link with teammates on phones or PCs. Your Mac is the Agent terminal;
Univer Workspace remains the collaboration and authorization service.

```text
OpenClaw + plugin + CLI on your Mac
                |
                v
       shared Univer Worktree
          /             \
 phone browser       PC browser
```

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
- `univer-workspace-cli` 0.5.1 or newer available on the Gateway host
- Access to a Univer Workspace deployment

Install the Workspace CLI used by DreamNum deployments:

```bash
npm install -g univer-workspace-cli --registry=https://insider-npm-registry.univer.work/
univer-workspace-cli --version
univer-workspace-cli config get workspace.origin
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

## Share a collaborative Worktree

Use a Team Space Worktree with Space visibility when other people should work in the same draft:

```text
scope=space + visibility=space -> visible to members of that Team Space
scope=user or visibility=private -> private Agent draft
```

Creating a Space-visible Worktree, or changing an existing Team Space Worktree to Space visibility,
raises an OpenClaw approval prompt. After approval, ask OpenClaw to generate the review URL and send
it to your collaborators. They sign in to Univer Workspace and open the same draft on phone or PC.
Presence, realtime edits, comments, history, and the Worktree review lifecycle stay in Univer.

The link is not a bearer token and does not create anonymous access. Invite each collaborator to the
owning Team Space first. A Personal Space or user-scoped Worktree remains private even if someone has
its URL.

For live co-editing, share the URL while the Worktree is still `draft`. Before final checks, make sure
collaborators have finished their edits, inspect the latest stored content, then mark it `ready`. Ready
creates the review boundary but does not merge. Reopen for another editing round or merge only after
the user approves.

## Run your own complete Workspace with OpenClaw

The plugin can supervise a built `univer-workspace` application as a Gateway companion service. This
uses the real Workspace Browser, product API, Collaboration server, Worktree service, authentication,
and SQLite stores; it does not replace them with a standalone editor shell.

Build only the Workspace application with Node.js 24. For a non-local browser address, provide a
Univer browser license issued for that hostname at build time:

```bash
cd /path/to/univer-workspace
VITE_UNIVER_LICENSE="$UNIVER_WORKSPACE_BROWSER_LICENSE" \
  pnpm --filter @univerjs/univer-workspace build
```

Then configure the plugin with the built application and public URL:

```json5
{
  plugins: {
    entries: {
      "univer-office": {
        enabled: true,
        config: {
          viewerUrl: "https://office.example.com",
          selfHosted: {
            workspaceRoot: "/path/to/univer-workspace/apps/workspace",
            nodePath: "/absolute/path/to/node-24/bin/node",
            host: "127.0.0.1",
            port: 3017,
          },
        },
      },
    },
  },
}
```

On Gateway startup, the plugin starts the built Workspace, stores its product, Collaboration, and
Blob data below the OpenClaw state directory by default, and points Workspace CLI at the local
instance. Put an authenticated HTTPS reverse proxy or tunnel in front of that local port. Password
authentication works without OAuth; provider login requires the corresponding Workspace server
environment to be configured by a separate deployment service.

### Choose the URL collaborators open

By default, the CLI builds review links from `workspace.origin`. This is enough for the hosted
Workspace at `https://workspace.univer.plus/` and for deployments where the API and Web editor use
the same public URL.

Set `viewerUrl` when collaborators must open a different complete Workspace deployment—for example,
a Tailscale, intranet, or HTTPS reverse-proxy address:

```json5
{
  plugins: {
    entries: {
      "univer-office": {
        enabled: true,
        config: {
          viewerUrl: "https://office.example.com",
        },
      },
    },
  },
}
```

`viewerUrl` changes only the generated review link. It must serve the complete Univer Workspace
application, including its authenticated product API and collaboration endpoints; a standalone
Univer editor or custom review shell is not compatible. Configure the CLI's Workspace API endpoint
separately when needed:

```bash
univer-workspace-cli config set workspace.origin https://workspace-api.example.com
```

Do not share a `localhost` URL; it points back to each recipient's own device. For a Workspace hosted
on your Mac, give it a stable LAN, Tailscale, or authenticated HTTPS address and use that address as
`viewerUrl`. Expose the complete Univer Workspace Web/API/collaboration service—not the OpenClaw
Gateway—and keep Workspace authentication enabled.

## Sign in

Ask OpenClaw to connect to Univer Workspace. The plugin starts the CLI's browser approval flow and
returns a verification URL and code. Open that URL on phone or PC, approve it, then tell OpenClaw
you are done. The completion call is separately approval-gated and is never polled.

## Typical request

> Find our Q2 sales workbook, create a Team Space collaborative draft, let the Space members review
> it from phone or PC, verify the formulas and layout, then send me the link. Do not merge until I
> approve it.

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
- making a Worktree visible to Team Space members;
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
openclaw plugins install npm-pack:/tmp/dream-num-openclaw-univer-office-0.5.0.tgz --force
openclaw plugins inspect univer-office --runtime --json
```

## License

Apache-2.0
