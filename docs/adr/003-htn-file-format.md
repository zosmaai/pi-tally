# ADR-003 — HTN file format

**Date:** 2026-06-01
**Status:** Accepted

## Context

The pi-tally skill instructs the LLM to plan TallyPrime tasks **top-down**: identify the top-level compound task, decompose into methods, expand to primitive tool calls, present plan to user, then execute. This is Hierarchical Task Network (HTN) planning.

We need a file format for the canonical task library shipped at `skills/pi-tally/htn/`.

## Alternatives considered

1. **YAML** — structured, parseable, but verbose and hard for LLMs to read inline.
2. **Pure prose Markdown** — readable, but unstructured; LLM can drift from the format.
3. **JSON** — machine-friendly, human-hostile.
4. **Markdown + fenced HTN block** (chosen) — human-readable narrative around a fenced code block with a strict format the LLM can pattern-match.

## Decision

Each task lives in its own `.md` file under `skills/pi-tally/htn/`. The file has:

1. A brief **prose intro** (when this task applies, prerequisites)
2. A **fenced `htn` block** with the strict tree format
3. A **worked example** (one or two real prompts that should map to this tree)
4. **Common variations** (alternative methods)

Format of the fenced block:

````
```htn
TASK: TaskName(arg1, arg2)
  precond: <natural-language conditions>
  method: <method-name>
    1. <tool_name>(<args>)                      [primitive]
    2. <SubTaskName>(<args>)                    [compound]
         method: <submethod-name>
           a. ...
           b. ...
    3. <tool_name>(<args>)                      [primitive, gated]
```
````

Annotations:
- `[primitive]` — direct tool call
- `[compound]` — expands to a sub-tree (defined elsewhere or inline)
- `[gated]` — requires the relevant write-gate to be open

## Why this format

- LLMs read Markdown natively and can quote the relevant tree back to the user as a plan
- Fenced ` ```htn` blocks are easy to extract programmatically if we later add static analysis
- Community contributors can add new trees as PRs without touching code
- Future fine-tuning datasets can extract the fenced blocks as supervised examples
- Worked examples teach the LLM how natural prompts map to formal tasks

## Consequences

- HTN library becomes a first-class extension point — community can contribute
- Skill stays under pi's typical skill load budget (each HTN file is small)
- Adding a new workflow is "write a markdown file", not "write code"
