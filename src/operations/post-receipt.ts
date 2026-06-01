/**
 * Operation: post a Receipt voucher to Tally.
 *
 * This is the FIRST end-to-end write path in pi-tally and the reference
 * shape every subsequent voucher tool (`postPayment`, `postContra`,
 * `postJournal`, …) will follow:
 *
 *   1. `assertGate(cfg, "vouchers")`       — Ring 1, fail-fast
 *   2. preflight read (party + dest exist) — catches 90% of LINEERRORs
 *   3. `confirmWrite(ctx, preview, audit)` — Ring 2, audit on accept/decline
 *   4. `client.send(buildPostReceiptEnvelope(input))` — wire
 *   5. parse the response, audit `write.submitted` (with vchId), return
 *
 * The function is intentionally callable BOTH from a real extension tool
 * handler (PR3) and from a standalone `scripts/manual-post-receipt.mjs`
 * (immediately, for live testing). The only difference is who supplies
 * `ctx` — a real pi session vs. a hand-rolled mock.
 *
 * Idempotency keys + dry-run mode land in PR2; for now we offer a `dryRun`
 * flag that stops after the confirm step.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TallyClient } from "../client.js";
import type { TallyConfig } from "../config.js";
import { assertGate } from "../safety/gates.js";
import { confirmWrite, type WritePreview } from "../ui/confirm.js";
import { appendAuditEvent } from "../audit/log.js";
import { buildPostReceiptEnvelope, type PostReceiptInput } from "../envelopes.js";
import { formatINR } from "../config.js";
import { extractTag } from "../parse.js";
import { validatePostReceiptInput } from "./validate.js";

type ExtensionCtx = Parameters<
  Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]
>[1];

export interface PostReceiptOptions extends PostReceiptInput {
  /** If true, run all safety rings + render preview but skip the actual send. */
  dryRun?: boolean;
}

export interface PostReceiptResult {
  outcome: "submitted" | "declined" | "dry-run";
  /** Tally's last voucher ID, if returned in the response. */
  vchId?: string;
  /** The preview body shown to the user (echoed for logging). */
  previewBody?: string;
}

export interface ParsedPostResponse {
  success: boolean;
  created: number;
  altered: number;
  lastVchId?: string;
}

/**
 * Parse a voucher import response. Tolerant of:
 *   - With or without <RESPONSE> wrapper
 *   - Missing <LASTVCHID> (some Prime builds drop it)
 *   - <CREATED>0</CREATED> meaning "Tally accepted but did nothing" (treat as failure)
 *
 * Note: hard errors (<LINEERROR>, <ERRORMSG>) are already converted to
 * TallyError by TallyClient.send before reaching here.
 */
export function parsePostVoucherResponse(body: string): ParsedPostResponse {
  const created = Number.parseInt(extractTag(body, "CREATED") ?? "0", 10) || 0;
  const altered = Number.parseInt(extractTag(body, "ALTERED") ?? "0", 10) || 0;
  const lastVchId = extractTag(body, "LASTVCHID");
  return {
    created,
    altered,
    lastVchId,
    success: created >= 1,
  };
}

/**
 * Execute the full receipt-posting flow with all rings.
 *
 * Throws:
 *   - TallyWriteBlockedError if the vouchers gate is closed
 *   - TallyError on Tally-side failure (timeout, LINEERROR, etc.)
 *   - Any error returned by buildPostReceiptEnvelope (e.g. amount <= 0)
 *
 * Returns:
 *   - { outcome: "submitted", vchId } on success
 *   - { outcome: "declined" }         if the user clicked No
 *   - { outcome: "dry-run" }          if dryRun was set and confirm passed
 */
export async function postReceipt(
  ctx: ExtensionCtx,
  cfg: TallyConfig,
  client: TallyClient,
  auditDirPath: string,
  opts: PostReceiptOptions,
): Promise<PostReceiptResult> {
  // ---- Ring 1 ----
  assertGate(cfg, "vouchers");

  // ---- Pre-confirm validation (PR2 wart fix) ----
  // Run cheap structural checks BEFORE rendering the preview so the human
  // never sees a junk modal to click "no" on.
  validatePostReceiptInput(opts);

  // ---- Preview (Ring 2 input) ----
  const preview: WritePreview = {
    tool: "tally_post_receipt",
    title: "Post Receipt",
    summary: `${formatINR(opts.amount)} from ${opts.party} into ${opts.destinationLedger} on ${opts.date}`,
    fields: [
      ["Date", opts.date],
      ["Party", opts.party],
      ["Amount", formatINR(opts.amount)],
      ["Destination", opts.destinationLedger],
      ["Bill ref", opts.billRef ? `${opts.billRef.type}: ${opts.billRef.name}` : "(none — On Account)"],
      ["Narration", opts.narration ?? "(none)"],
      ["Company", opts.company],
    ],
  };

  // ---- Ring 2 ----
  const { accepted } = await confirmWrite(ctx, preview, auditDirPath);
  if (!accepted) {
    return { outcome: "declined", previewBody: preview.summary };
  }

  if (opts.dryRun) {
    appendAuditEvent(auditDirPath, {
      kind: "write.dry-run",
      tool: "tally_post_receipt",
      summary: preview.summary,
    });
    return { outcome: "dry-run", previewBody: preview.summary };
  }

  // ---- Wire ----
  const envelope = buildPostReceiptEnvelope(opts);
  appendAuditEvent(auditDirPath, {
    kind: "write.sending",
    tool: "tally_post_receipt",
    summary: preview.summary,
    bytes: envelope.length,
  });

  const body = await client.send(envelope);
  const parsed = parsePostVoucherResponse(body);

  appendAuditEvent(auditDirPath, {
    kind: parsed.success ? "write.submitted" : "write.no-op",
    tool: "tally_post_receipt",
    summary: preview.summary,
    vchId: parsed.lastVchId,
    created: parsed.created,
    altered: parsed.altered,
  });

  if (!parsed.success) {
    throw new Error(
      `Tally accepted the envelope but reported CREATED=${parsed.created}. ` +
        `No voucher was posted. Verify the party / destination ledgers exist and the date is within the FY.`,
    );
  }

  return {
    outcome: "submitted",
    vchId: parsed.lastVchId,
    previewBody: preview.summary,
  };
}
