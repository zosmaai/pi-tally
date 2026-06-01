# HTN task trees

This directory holds canonical **Hierarchical Task Network** decompositions for
common TallyPrime workflows. Each `.md` file is a self-contained tree that
expands a compound accounting task into primitive `tally_*` tool calls.

## How the LLM uses these

The `SKILL.md` in the parent directory instructs the LLM to plan top-down:
1. Identify the top-level task from the user's prompt
2. Open the matching tree file
3. Restate the plan to the user in plain English
4. Execute primitives in order, re-planning at compound nodes

## File format

Each file follows this structure (see `financial-snapshot.md` for a complete example):

````markdown
# task-name — short description

## When this applies
## Pre-conditions
## Decomposition
```htn
TASK: TaskName(args)
  precond: ...
  method: ...
    1. <tool_or_subtask>(...)                                   [primitive|compound, gated?]
```
## Worked example
## Variations / Anti-patterns
````

Annotations inside the fenced block:
- `[primitive]` — direct `tally_*` tool call
- `[compound]` — expands to another subtree (defined inline or in another file)
- `[gated]` — requires the relevant write-gate to be open before execution
- `[confirmed]` — has its own per-call `ctx.ui.confirm()` prompt

## v1 trees (shipped)

| Tree | Description |
|---|---|
| `financial-snapshot.md` | "How are we doing?" multi-report synthesis |
| `post-receipt.md` | Customer receipt with bill-ref matching |
| `month-end-close.md` | Top-level monthly close, 8 subtasks |

## v1 trees (in progress)

| Tree | Status |
|---|---|
| `post-invoice.md` | v0.3 |
| `post-payment.md` | v0.3 |
| `post-journal.md` | v0.3 |
| `bulk-import-vouchers.md` | v0.4 |
| `reconcile-bank.md` | v0.4 |
| `party-statement.md` | v0.5 |
| `investigate-mismatch.md` | v0.5 |

## v2+ trees (roadmapped)

| Tree | Version |
|---|---|
| `gst-return-prep.md` (GSTR-1 + GSTR-3B) | v2.0 |
| `tds-deduct-and-pay.md` (Form 26Q) | v2.0 |
| `close-financial-year.md` (annual close) | v2.0 |
| `audit-preparation.md` | v2.0 |
| `payroll-month.md` | v3.5 |
| `multi-client-rounds.md` (persona A) | v3.0 |

## Contributing your own trees

You can drop firm-specific trees at `.pi/pi-tally/htn/*.md` inside any project.
Pi auto-discovers them on session start. The format above is enforced only by
convention — the LLM reads the prose; we don't statically validate the fenced
blocks. Keep them small, name them precisely, and include a worked example.

For trees you think the community would benefit from, open a PR at
[github.com/zosmaai/pi-tally](https://github.com/zosmaai/pi-tally).
