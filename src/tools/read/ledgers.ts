/**
 * tally_list_ledgers + tally_list_groups + tally_list_voucher_types
 *
 * All three are flat collection reads. Filtering is client-side after parse.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { TallyClient } from "../../client.js";
import { loadConfig, formatINR } from "../../config.js";
import {
  buildListGroupsEnvelope,
  buildListLedgersEnvelope,
  buildListVoucherTypesEnvelope,
} from "../../envelopes.js";
import { parseGroups, parseLedgers, parseVoucherTypes } from "../../parse.js";

const LEDGERS_PARAMS = Type.Object({
  parent: Type.Optional(
    Type.String({
      description:
        "Filter by group name (e.g. 'Sundry Debtors', 'Sundry Creditors', 'Bank Accounts', 'Direct Expenses'). Case-insensitive contains.",
    }),
  ),
  namePattern: Type.Optional(
    Type.String({
      description: "Filter by ledger name (case-insensitive contains).",
    }),
  ),
  nonZeroOnly: Type.Optional(
    Type.Boolean({ description: "If true, return only ledgers with a non-zero closing balance." }),
  ),
});

const GROUPS_PARAMS = Type.Object({});
const VTYPES_PARAMS = Type.Object({});

export function registerLedgerTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "tally_list_ledgers",
    label: "List Tally Ledgers",
    description:
      "List ledgers in the active company. Supports filtering by parent group, name pattern, or non-zero closing balance. Returns name, parent group, opening/closing balance, GST registration, and contact details when present.",
    promptSnippet:
      "List Tally ledgers with optional filters (parent group, name pattern, non-zero balance)",
    promptGuidelines: [
      "Use tally_list_ledgers when the user asks about parties, customers, suppliers, bank accounts, expense ledgers, or balance lookups.",
      "Prefer narrow filters (parent, namePattern) when the user mentions a known group or party — returning the full chart of accounts is wasteful.",
    ],
    parameters: LEDGERS_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const cfg = loadConfig(ctx.cwd);
      const client = new TallyClient({ url: cfg.url, timeoutMs: cfg.timeoutMs });
      const body = await client.send(
        buildListLedgersEnvelope({ company: cfg.defaultCompany }),
      );
      let ledgers = parseLedgers(body);

      if (params.parent) {
        const p = params.parent.toLowerCase();
        ledgers = ledgers.filter((l) => l.parent.toLowerCase().includes(p));
      }
      if (params.namePattern) {
        const n = params.namePattern.toLowerCase();
        ledgers = ledgers.filter((l) => l.name.toLowerCase().includes(n));
      }
      if (params.nonZeroOnly) {
        ledgers = ledgers.filter((l) => (l.closingBalance ?? 0) !== 0);
      }

      const lines = ledgers.map((l) => {
        const bal = l.closingBalance !== undefined ? ` ${formatINR(l.closingBalance)}` : "";
        const grp = l.parent ? ` [${l.parent}]` : "";
        return `• ${l.name}${grp}${bal}`;
      });
      return {
        content: [
          {
            type: "text",
            text:
              lines.length === 0
                ? "No ledgers matched the filters."
                : `${lines.length} ledger(s):\n${lines.join("\n")}`,
          },
        ],
        details: { ledgers, count: lines.length },
      };
    },
  });

  pi.registerTool({
    name: "tally_list_groups",
    label: "List Tally Groups",
    description:
      "List account groups in the active company (the chart-of-accounts hierarchy). Returns name, parent, and revenue/capital classification.",
    promptSnippet: "List Tally account groups (chart of accounts hierarchy)",
    promptGuidelines: [
      "Use tally_list_groups when the user asks about the chart of accounts, expense categories, or where to file a new ledger.",
    ],
    parameters: GROUPS_PARAMS,
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const cfg = loadConfig(ctx.cwd);
      const client = new TallyClient({ url: cfg.url, timeoutMs: cfg.timeoutMs });
      const body = await client.send(buildListGroupsEnvelope({ company: cfg.defaultCompany }));
      const groups = parseGroups(body);
      const lines = groups.map((g) => `• ${g.name} → ${g.parent || "(root)"}`);
      return {
        content: [
          {
            type: "text",
            text: lines.length ? `${lines.length} groups:\n${lines.join("\n")}` : "No groups.",
          },
        ],
        details: { groups },
      };
    },
  });

  pi.registerTool({
    name: "tally_list_voucher_types",
    label: "List Tally Voucher Types",
    description:
      "List voucher types (built-in + user-defined) in the active company. Useful when posting a voucher to confirm the exact type name.",
    promptSnippet: "List Tally voucher types",
    promptGuidelines: [
      "Use tally_list_voucher_types when the user mentions a custom voucher type name or when about to post a voucher and needing to confirm the exact spelling.",
    ],
    parameters: VTYPES_PARAMS,
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const cfg = loadConfig(ctx.cwd);
      const client = new TallyClient({ url: cfg.url, timeoutMs: cfg.timeoutMs });
      const body = await client.send(
        buildListVoucherTypesEnvelope({ company: cfg.defaultCompany }),
      );
      const vtypes = parseVoucherTypes(body);
      const lines = vtypes.map((v) => `• ${v.name}  (parent: ${v.parent})`);
      return {
        content: [
          {
            type: "text",
            text: lines.length
              ? `${lines.length} voucher type(s):\n${lines.join("\n")}`
              : "No voucher types.",
          },
        ],
        details: { voucherTypes: vtypes },
      };
    },
  });
}
