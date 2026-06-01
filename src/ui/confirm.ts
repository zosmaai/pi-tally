/**
 * Ring 2 — pre-submit confirmation panel.
 *
 * Every write tool MUST call `confirmWrite()` after `assertGate()` and
 * before any XML envelope leaves the process. The function:
 *
 *   1. Renders a deterministic preview from structured fields (never raw
 *      XML, never a free-text LLM string).
 *   2. Shows a yes/no modal via `ctx.ui.confirm()` — the host CLI's standard
 *      modal API. (A richer pi-tui panel can replace this later; the
 *      function signature stays.)
 *   3. Writes a `write.confirmed` or `write.declined` event to the audit
 *      log BEFORE returning, so the operator's decision is traceable even
 *      if the caller crashes immediately afterward.
 *
 * The structured `WritePreview` shape is the integration contract between
 * write tools (PR3+) and the safety layer. Add fields conservatively —
 * the more compact the preview, the more reliably the human will read it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendAuditEvent } from "../audit/log.js";

/**
 * The single `ctx` object passed to extension tool / command handlers.
 * We don't try to import its exact type from pi-coding-agent (it's deeply
 * generic in the host); a structural alias keeps testing trivial.
 */
type ExtensionCtx = Parameters<
  Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]
>[1];

export interface WritePreview {
  /** Tool name, e.g. "tally_post_receipt". Recorded in the audit row. */
  tool: string;
  /** Modal title — short, action-oriented. e.g. "Post Receipt". */
  title: string;
  /** One-line summary shown above the field table and stored in audit. */
  summary: string;
  /** Ordered [label, value] pairs. Both must be safe display strings. */
  fields: ReadonlyArray<readonly [string, string]>;
  /** Optional warnings (e.g. "Education mode", "Date is in future"). */
  warnings?: ReadonlyArray<string>;
}

export interface ConfirmResult {
  accepted: boolean;
}

/**
 * Build the deterministic confirmation body shown in the modal. Pure
 * function — same input always produces the same string, no clocks, no
 * randomness. Tests rely on this.
 */
export function renderPreview(preview: WritePreview): string {
  const lines: string[] = [];
  // Echo the title into the body too — some host renderers strip the
  // modal title or only show it in a compact header; the body must be
  // self-contained so the audit-log replay reads naturally as well.
  lines.push(preview.title);
  lines.push("");
  lines.push(preview.summary);
  lines.push("");
  const labelWidth = Math.max(...preview.fields.map(([k]) => k.length));
  for (const [k, v] of preview.fields) {
    lines.push(`  ${k.padEnd(labelWidth)}  ${v}`);
  }
  if (preview.warnings && preview.warnings.length > 0) {
    lines.push("");
    for (const w of preview.warnings) {
      lines.push(`  ⚠ ${w}`);
    }
  }
  lines.push("");
  lines.push("Proceed?");
  return lines.join("\n");
}

/**
 * Render the preview, ask the user, and record the decision in the audit
 * log. `auditDirPath` is injected so tests can use a tmpdir.
 */
export async function confirmWrite(
  ctx: ExtensionCtx,
  preview: WritePreview,
  auditDirPath: string,
): Promise<ConfirmResult> {
  const body = renderPreview(preview);
  const accepted = await ctx.ui.confirm(preview.title, body);
  appendAuditEvent(auditDirPath, {
    kind: accepted ? "write.confirmed" : "write.declined",
    tool: preview.tool,
    summary: preview.summary,
  });
  return { accepted };
}
