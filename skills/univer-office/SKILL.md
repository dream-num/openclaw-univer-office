---
name: univer-office
description: "Create, edit, inspect, visually verify, review, and deliver Sheet, Doc, Slide, Base, and Board artifacts through Univer Workspace Worktrees."
metadata: { "openclaw": { "emoji": "📊" } }
---

# Univer Office

Use the `univer_office_*` tools for Office artifact work. The remote Workspace is authoritative;
do not replace this workflow with a local spreadsheet, document, or slide writer.

## Identity and isolation

- Keep `space_id`, `node_id`, `resource_id`, `unit_id`, and `worktree_id` distinct.
- Start every new user task in a new Worktree.
- Reuse a Worktree only for rework on that same known task. Reopen a `ready` Worktree before editing.
- Never reuse a `merged` or `discarded` Worktree.
- Find an existing file by stable Resource identity before staging it. Do not pick an ambiguous name.

## Workflow

1. Call `univer_office_connect` with `status`. If unauthenticated, call `start_login`, show the URL
   and code, and stop. Call `complete_login` only after the user confirms browser approval.
2. Discover the target Space and file with `univer_office_files`.
3. Create a Worktree with `univer_office_worktree`. Stage an existing `resource_id`, create a new
   Unit, or import an Office file from the active OpenClaw workspace.
4. Before authoring, call `univer_office_content` with `guidance` for `core` and the Unit type.
   Use `api_find` or `api_show` instead of guessing Facade methods.
5. Edit with `execute`. Read back with `inspect`; recalculate or lint where relevant.
6. Use `univer_office_handoff` with `screenshot` for visual verification. Inspect Sheet layout,
   Doc pagination, every Slide page, and the relevant Base or Board view.
7. Mark the Worktree `ready`, read it back, then request `review_url`. Return the URL together with
   the Worktree and Unit ids. The URL opens the full Univer Workspace on phone and PC.
8. Reopen for requested changes. Merge or discard only after an explicit user request and the
   OpenClaw approval prompt.
9. Export only when the user needs an `.xlsx`, `.csv`, `.tsv`, `.docx`, or `.pptx` deliverable.
   Send the returned local path through OpenClaw's normal message/file delivery surface.

## Approval boundary

- Univer `ready` means ready for review; it does not modify the current file version.
- Univer merge/discard controls the Office content lifecycle.
- OpenClaw plugin approval controls consequential agent actions such as merge, discard, or
  completing sign-in. Normal channel delivery remains owned by OpenClaw.
- Never treat one approval as permission for the other layer.

## Result quality

Command success is not correctness evidence. A completed artifact needs structural readback plus
visual inspection when layout matters. Return useful next steps and stable ids, not a bare success.
