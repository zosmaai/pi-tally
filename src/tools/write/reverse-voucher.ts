/**
 * tally_reverse_voucher — LLM-facing tool wrapping `reverseReceiptVoucher`.
 *
 * Posts an offsetting Payment voucher to undo a previously-posted Receipt.
 * Original and reversal both remain in the books — that's the textbook
 * accounting fix and the only path that actually works through Tally's
 * XML gateway (see memex card `tally-xml-cannot-truly-delete-vouchers`).
 *
 * v0.2 scope: Receipt → Payment reversal. Other directions land in v0.3.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { TallyClient, TallyError } from "../../client.js";
import { loadConfig } from "../../config.js";
import { reverseReceiptVoucher } from "../../operations/reverse-voucher.js";
import { TallyWriteBlockedError } from "../../safety/gates.js";
import { WriteValidationError } from "../../operations/validate.js";
import { auditDir } from "../../audit/log.js";

const PARAMS = Type.Object({
  originalVoucherRef: Type.String({
    description:
      "User-facing reference to the original Receipt being reversed. Typically the voucher number (e.g. 'RV/2026/2') or MasterID. Echoed in the reversal narration for audit trail.",
  }),
  party: Type.String({
    description: "The Sundry Debtor ledger that received the original receipt.",
  }),
  destinationLedger: Type.String({
    description:
      "The Cash or Bank ledger the original receipt credited. Becomes the source of the reversal Payment.",
  }),
  date: Type.String({
    description:
      "ISO date YYYY-MM-DD for the reversal entry. Typically today; cannot be earlier than the original receipt's date.",
  }),
  amount: Type.Number({
    description: "Positive rupee amount being reversed. Must match the original receipt.",
  }),
  extraNarration: Type.Optional(
    Type.String({ description: "Optional extra narration appended after 'REVERSAL of …'." }),
  ),
  dryRun: Type.Optional(Type.Boolean({ description: "If true, preview only — don't submit." })),
});

export function registerReverseVoucherTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "tally_reverse_voucher",
    label: "Reverse Tally Voucher",
    description:
      "Reverse a previously-posted Receipt voucher by emitting an offsetting Payment voucher. Both vouchers remain in the books — this is the textbook accounting fix. Use when a Receipt was posted incorrectly and needs to be undone. TallyPrime's XML gateway cannot truly delete vouchers without UI-level permission, so reversal is the only programmatic undo path.",
    promptSnippet: "Reverse a Tally Receipt by posting an offsetting Payment voucher",
    promptGuidelines: [
      "Use tally_reverse_voucher to undo an incorrectly-posted Receipt. Both the original and the reversal stay in the books as an audit trail.",
      "Confirm with the user that posting a reversal (vs. asking them to delete in TallyPrime UI) is the right action — the audit trail will show both entries.",
      "Pass originalVoucherRef as the user-facing voucher number (e.g. 'RV/2026/2') so the audit trail links the two entries unambiguously.",
      "Do NOT use this for cancelling a Payment — that's a separate operation (v0.3).",
    ],
    parameters: PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const cfg = loadConfig(ctx.cwd);
      const client = new TallyClient({ url: cfg.url, timeoutMs: cfg.timeoutMs });
      if (!cfg.defaultCompany) {
        return {
          content: [
            {
              type: "text",
              text: "No active company set. Ask the user to run /tally use-company <name> first.",
            },
          ],
          details: { outcome: "error", error: "NO_ACTIVE_COMPANY" },
        };
      }
      try {
        const r = await reverseReceiptVoucher(ctx as any, cfg, client, auditDir(), {
          company: cfg.defaultCompany,
          originalVoucherRef: params.originalVoucherRef,
          party: params.party,
          destinationLedger: params.destinationLedger,
          date: params.date,
          amount: params.amount,
          extraNarration: params.extraNarration,
          dryRun: params.dryRun,
        });
        return renderResult(r, params.originalVoucherRef);
      } catch (e) {
        return renderError(e);
      }
    },
  });
}

function renderResult(
  r: { outcome: string; vchId?: string; previewBody?: string },
  ref: string,
) {
  if (r.outcome === "submitted") {
    return {
      content: [
        {
          type: "text" as const,
          text: `✓ Reversal posted. Reversal voucher ID: ${r.vchId ?? "(not returned)"}. Original receipt ${ref} remains in the books for audit trail.`,
        },
      ],
      details: r,
    };
  }
  if (r.outcome === "declined") {
    return {
      content: [{ type: "text" as const, text: "User declined the reversal. Books unchanged." }],
      details: r,
    };
  }
  if (r.outcome === "dry-run") {
    return {
      content: [
        {
          type: "text" as const,
          text: `Dry-run only — no reversal posted. Preview: ${r.previewBody ?? "(empty)"}`,
        },
      ],
      details: r,
    };
  }
  return {
    content: [{ type: "text" as const, text: `Unknown outcome: ${r.outcome}` }],
    details: r,
  };
}

function renderError(e: unknown) {
  if (e instanceof TallyWriteBlockedError) {
    return {
      content: [{ type: "text" as const, text: `BLOCKED: ${e.message}` }],
      details: { outcome: "blocked", ...e.toJSON() },
    };
  }
  if (e instanceof WriteValidationError) {
    return {
      content: [
        { type: "text" as const, text: `INVALID INPUT (field=${e.field}): ${e.message}` },
      ],
      details: { outcome: "invalid", code: e.code, field: e.field, message: e.message },
    };
  }
  if (e instanceof TallyError) {
    return {
      content: [
        { type: "text" as const, text: `Tally rejected the reversal (${e.kind}): ${e.message}` },
      ],
      details: { outcome: "tally-error", kind: e.kind, message: e.message },
    };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return {
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
    details: { outcome: "error", message: msg },
  };
}
