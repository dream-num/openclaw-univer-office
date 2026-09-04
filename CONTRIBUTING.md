# Contributing

Thanks for helping improve Univer Office for OpenClaw.

## Development

Requirements:

- Node.js 22.22.3 or newer
- npm

Install dependencies and run the complete validation suite:

```bash
npm install
npm run check
```

The repository intentionally tracks `dist/` because OpenClaw installs Git plugins with lifecycle
scripts disabled. After changing TypeScript source, run `npm run build` and commit the corresponding
generated files. `npm run check` rejects stale generated output.

Keep pull requests focused, describe user-visible behavior, and include tests for behavior changes.
Pull request titles and descriptions should be written in English.

## Reporting bugs

Use a GitHub issue for reproducible non-security bugs. Include the OpenClaw version, plugin version,
Workspace CLI version, and the shortest safe reproduction you can provide. Never include access
tokens, passwords, private Workspace URLs, or document contents.
