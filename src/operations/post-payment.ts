/**
 * Operation: post a Payment voucher to Tally.
 *
 * Mirror of `postReceipt` — same ring flow, same audit-event kinds,
 * Payment envelope shape. Used directly for vendor payments / refunds,
 * and as the backing call for `reverseReceiptVoucher`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TallyClient } from "../client.js";
import type { TallyConfig } from "../config.js";
import { assertGate } from "../safety/gates.js";
import { confirmWrite, type WritePreview } from "../ui/confirm.js";
import { appendAuditEvent } from "../audit/log.js";
import { buildPostPaymentEnvelope, type PostPaymentInput } from "../envelopes.js";
import { formatINR } from "../config.js";
import { validatePostPaymentInput } from "./validate.js";
import { parsePostVoucherResponse, type PostReceiptResult } from "./post-receipt.js";

type ExtensionCtx = Parameters<
  Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]
>[1];

export interface PostPaymentOptions extends PostPaymentInput {
  dryRun?: boolean;
  /** Override tool name used in audit + preview (e.g. "tally_reverse_voucher"). Default: "tally_post_payment". */
  toolName?: string;
  /** Override modal title. Default: "Post Payment". */
  title?: string;
}

export async function postPayment(
  ctx: ExtensionCtx,
  cfg: TallyConfig,
  client: TallyClient,
  auditDirPath: string,
  opts: PostPaymentOptions,
): Promise<PostReceiptResult> {
  const tool = opts.toolName ?? "tally_post_payment";
  const title = opts.title ?? "Post Payment";

  // Ring 1
  assertGate(cfg, "vouchers");
  // Pre-confirm validation
  validatePostPaymentInput(opts);

  const preview: WritePreview = {
    tool,
    title,
    summary: `Pay ${formatINR(opts.amount)} to ${opts.party} from ${opts.sourceLedger} on ${opts.date}`,
    fields: [
      ["Date", opts.date],
      ["Party", opts.party],
      ["Amount", formatINR(opts.amount)],
      ["Source", opts.sourceLedger],
      ["Bill ref", opts.billRef ? `${opts.billRef.type}: ${opts.billRef.name}` : "(none — On Account)"],
      ["Narration", opts.narration ?? "(none)"],
      ["Company", opts.company],
    ],
  };

  // Ring 2
  const { accepted } = await confirmWrite(ctx, preview, auditDirPath);
  if (!accepted) {
    return { outcome: "declined", previewBody: preview.summary };
  }

  if (opts.dryRun) {
    appendAuditEvent(auditDirPath, {
      kind: "write.dry-run",
      tool,
      summary: preview.summary,
    });
    return { outcome: "dry-run", previewBody: preview.summary };
  }

  const envelope = buildPostPaymentEnvelope(opts);
  appendAuditEvent(auditDirPath, {
    kind: "write.sending",
    tool,
    summary: preview.summary,
    bytes: envelope.length,
  });

  const body = await client.send(envelope);
  const parsed = parsePostVoucherResponse(body);

  appendAuditEvent(auditDirPath, {
    kind: parsed.success ? "write.submitted" : "write.no-op",
    tool,
    summary: preview.summary,
    vchId: parsed.lastVchId,
    created: parsed.created,
    altered: parsed.altered,
  });

  if (!parsed.success) {
    throw new Error(
      `Tally accepted the envelope but reported CREATED=${parsed.created}. ` +
        `No voucher was posted. Verify the party / source ledgers exist and the date is within the FY.`,
    );
  }

  return {
    outcome: "submitted",
    vchId: parsed.lastVchId,
    previewBody: preview.summary,
  };
}
