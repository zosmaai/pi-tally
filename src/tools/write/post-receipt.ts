/**
 * tally_post_receipt — LLM-facing tool wrapping `postReceipt`.
 *
 * Wraps every error class the operation throws into a structured tool
 * result the LLM can reason about without retrying blindly:
 *   - TallyWriteBlockedError       → text says "ask the user to run …"
 *   - WriteValidationError         → text names the offending field
 *   - TallyError (LINEERROR etc.)  → text shows Tally's own message
 *   - Generic Error                → fallback, message echoed
 *
 * details payload always carries { outcome, vchId? } so a calling agent
 * can branch on the outcome programmatically.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { TallyClient, TallyError } from "../../client.js";
import { loadConfig } from "../../config.js";
import { postReceipt } from "../../operations/post-receipt.js";
import { TallyWriteBlockedError } from "../../safety/gates.js";
import { WriteValidationError } from "../../operations/validate.js";
import { auditDir } from "../../audit/log.js";

const PARAMS = Type.Object({
  party: Type.String({
    description:
      "Exact Sundry Debtor / customer ledger name as it appears in Tally. Case-sensitive. Use tally_list_ledgers with parent='Sundry Debtors' to confirm spelling.",
  }),
  destinationLedger: Type.String({
    description:
      "Exact Cash or Bank ledger name receiving the money (e.g. 'Cash', 'HDFC Current A/c'). Case-sensitive.",
  }),
  date: Type.String({
    description: "ISO date YYYY-MM-DD. Must fall within the company's current financial year.",
  }),
  amount: Type.Number({
    description: "Positive rupee amount (₹). Use the numeric value, not a string with currency symbols.",
  }),
  narration: Type.Optional(
    Type.String({ description: "Optional free-text narration shown in Tally." }),
  ),
  billRef: Type.Optional(
    Type.Object({
      name: Type.String({ description: "Bill reference name (invoice number or 'On Account')." }),
      type: Type.String({ description: "One of: 'On Account', 'Advance', 'Agst Ref', 'New Ref'." }),
    }),
  ),
  dryRun: Type.Optional(
    Type.Boolean({
      description:
        "If true, run all safety rings and show the confirmation modal but skip the actual Tally submit. Useful for previewing.",
    }),
  ),
});

export function registerPostReceiptTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "tally_post_receipt",
    label: "Post Tally Receipt",
    description:
      "Post a Receipt voucher to TallyPrime — money received from a customer into a Cash/Bank ledger. Goes through the safety rings: write-gate check, structured-input validation, user confirmation modal, audit-log entry. Returns the Tally voucher ID on success.",
    promptSnippet: "Post a Receipt voucher in Tally (customer payment received)",
    promptGuidelines: [
      "Use tally_post_receipt when the user wants to record money received from a customer.",
      "Before calling, verify the party ledger exists (tally_list_ledgers parent='Sundry Debtors') and the destination Cash/Bank ledger exists (parent='Cash-in-Hand' or 'Bank Accounts').",
      "If the call throws GATE_CLOSED, ask the user to run the named command. Do NOT retry until the user confirms.",
      "If the call throws INVALID_INPUT, fix the named field and ask the user to confirm the corrected value before retrying.",
      "Always use the exact ledger names returned by tally_list_ledgers — case-sensitive. Do not invent or abbreviate.",
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
        const r = await postReceipt(ctx as any, cfg, client, auditDir(), {
          company: cfg.defaultCompany,
          party: params.party,
          destinationLedger: params.destinationLedger,
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
          text: `✓ Receipt posted. Tally voucher ID: ${r.vchId ?? "(not returned)"}.`,
        },
      ],
      details: r,
    };
  }
  if (r.outcome === "declined") {
    return {
      content: [
        { type: "text" as const, text: "User declined the receipt. No voucher was posted." },
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
      content: [
        {
          type: "text" as const,
          text: `BLOCKED: ${e.message}`,
        },
      ],
      details: { outcome: "blocked", ...e.toJSON() },
    };
  }
  if (e instanceof WriteValidationError) {
    return {
      content: [
        {
          type: "text" as const,
          text: `INVALID INPUT (field=${e.field}): ${e.message}`,
        },
      ],
      details: { outcome: "invalid", code: e.code, field: e.field, message: e.message },
    };
  }
  if (e instanceof TallyError) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Tally rejected the voucher (${e.kind}): ${e.message}`,
        },
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
