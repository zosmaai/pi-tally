/**
 * tally_post_payment — LLM-facing tool wrapping `postPayment`.
 * Mirror of tally_post_receipt for the outflow direction.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { TallyClient, TallyError } from "../../client.js";
import { loadConfig } from "../../config.js";
import { postPayment } from "../../operations/post-payment.js";
import { TallyWriteBlockedError } from "../../safety/gates.js";
import { WriteValidationError } from "../../operations/validate.js";
import { auditDir } from "../../audit/log.js";

const PARAMS = Type.Object({
  party: Type.String({
    description:
      "Exact party ledger name receiving the payment (Sundry Creditor for vendor payments, Sundry Debtor for customer refunds, or an Expense ledger for direct expenses). Case-sensitive.",
  }),
  sourceLedger: Type.String({
    description: "Exact Cash or Bank ledger name the money leaves from. Case-sensitive.",
  }),
  date: Type.String({ description: "ISO date YYYY-MM-DD within the company's current FY." }),
  amount: Type.Number({ description: "Positive rupee amount." }),
  narration: Type.Optional(Type.String({ description: "Optional narration." })),
  billRef: Type.Optional(
    Type.Object({
      name: Type.String(),
      type: Type.String({ description: "One of: 'On Account', 'Advance', 'Agst Ref', 'New Ref'." }),
    }),
  ),
  dryRun: Type.Optional(
    Type.Boolean({
      description: "If true, show preview but don't submit.",
    }),
  ),
});

export function registerPostPaymentTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "tally_post_payment",
    label: "Post Tally Payment",
    description:
      "Post a Payment voucher to TallyPrime — money paid out from a Cash/Bank ledger (vendor payment, customer refund, direct expense). Goes through the safety rings: write-gate check, validation, confirmation, audit-log. Returns the Tally voucher ID on success.",
    promptSnippet: "Post a Payment voucher in Tally (money leaving cash/bank)",
    promptGuidelines: [
      "Use tally_post_payment when the user wants to record money paid out: vendor invoice settlement, customer refund, direct expense, etc.",
      "For a customer refund, party is the Sundry Debtor; for a vendor payment, party is the Sundry Creditor.",
      "Verify both party and sourceLedger exist via tally_list_ledgers before posting.",
      "If the call throws GATE_CLOSED, ask the user to run the named command. Do NOT retry blindly.",
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
        const r = await postPayment(ctx as any, cfg, client, auditDir(), {
          company: cfg.defaultCompany,
          party: params.party,
          sourceLedger: params.sourceLedger,
          date: params.date,
          amount: params.amount,
          narration: params.narration,
          billRef: params.billRef as { name: string; type: any } | undefined,
          dryRun: params.dryRun,
        });
        return renderResult(r);
      } catch (e) {
        return renderError(e);
      }
    },
  });
}

function renderResult(r: { outcome: string; vchId?: string; previewBody?: string }) {
  if (r.outcome === "submitted") {
    return {
      content: [
        {
          type: "text" as const,
          text: `✓ Payment posted. Tally voucher ID: ${r.vchId ?? "(not returned)"}.`,
        },
      ],
      details: r,
    };
  }
  if (r.outcome === "declined") {
    return {
      content: [
        { type: "text" as const, text: "User declined the payment. No voucher was posted." },
      ],
      details: r,
    };
  }
  if (r.outcome === "dry-run") {
    return {
      content: [
        {
          type: "text" as const,
          text: `Dry-run only — no voucher posted. Preview: ${r.previewBody ?? "(empty)"}`,
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
        { type: "text" as const, text: `Tally rejected the voucher (${e.kind}): ${e.message}` },
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
