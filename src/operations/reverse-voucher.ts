/**
 * Operation: reverse a previously-posted Receipt by emitting an
 * offsetting Payment voucher.
 *
 * Why a wrapper instead of a true "delete" or "cancel" path:
 * TallyPrime's XML gateway cannot truly delete vouchers without
 * UI-level "Allow Deletion" permission (see memex card
 * `tally-xml-cannot-truly-delete-vouchers`). Posting a reversal
 * voucher is the textbook accounting fix and arguably more honest —
 * both the original and the reversal remain in the audit trail.
 *
 * This is the v0.2 scope: Receipt → Payment reversal. Other directions
 * (Payment → Receipt, Journal swaps) land in v0.3 with the full
 * cancellation HTN tree.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TallyClient } from "../client.js";
import type { TallyConfig } from "../config.js";
import { postPayment, type PostPaymentOptions } from "./post-payment.js";
import type { PostReceiptResult } from "./post-receipt.js";
import type { BillRefType } from "../envelopes.js";

type ExtensionCtx = Parameters<
  Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]
>[1];

export interface ReverseReceiptInput {
  company: string;
  /** The party (Sundry Debtor) that received the original receipt. */
  party: string;
  /** The cash / bank ledger the original receipt credited. Becomes the source of the reversal payment. */
  destinationLedger: string;
  /** ISO date YYYY-MM-DD for the reversal entry (typically today). */
  date: string;
  /** Positive rupee amount being reversed. */
  amount: number;
  /**
   * User-facing reference to the original voucher (e.g. "RV/2026/2",
   * voucher number, or master ID). Echoed in the narration and audit
   * trail so the reversal links unambiguously to its source.
   */
  originalVoucherRef: string;
  /** Optional extra narration text. */
  extraNarration?: string;
  /** Bill-ref type for the offsetting payment. Default "On Account". */
  billRefType?: BillRefType;
  dryRun?: boolean;
}

export async function reverseReceiptVoucher(
  ctx: ExtensionCtx,
  cfg: TallyConfig,
  client: TallyClient,
  auditDirPath: string,
  input: ReverseReceiptInput,
): Promise<PostReceiptResult> {
  const narration =
    `REVERSAL of voucher ${input.originalVoucherRef}` +
    (input.extraNarration ? ` — ${input.extraNarration}` : "");

  const paymentOpts: PostPaymentOptions = {
    company: input.company,
    party: input.party,
    sourceLedger: input.destinationLedger,
    date: input.date,
    amount: input.amount,
    narration,
    billRef: {
      name: `REVERSAL-${input.originalVoucherRef}`,
      type: input.billRefType ?? "On Account",
    },
    dryRun: input.dryRun,
    toolName: "tally_reverse_voucher",
    title: `Reverse Receipt ${input.originalVoucherRef}`,
  };

  return postPayment(ctx, cfg, client, auditDirPath, paymentOpts);
}
