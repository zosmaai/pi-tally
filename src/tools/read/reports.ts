/**
 * tally_get_report — built-in named reports.
 *
 * v0.1 implements: TrialBalance, DayBook (rendered cleanly).
 * Other report names are accepted and return raw collection data (for now)
 * with a marker that they'll get nicer renderers in v0.2.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { TallyClient } from "../../client.js";
import { loadConfig, formatINR } from "../../config.js";
import { buildDayBookEnvelope, buildReportEnvelope } from "../../envelopes.js";
import { parseDayBook, parseTrialBalance } from "../../parse.js";
import type { ReportName } from "../../types.js";

const REPORT_PARAMS = Type.Object({
  report: StringEnum([
    "TrialBalance",
    "DayBook",
    "BalanceSheet",
    "ProfitLoss",
    "CashBook",
    "BankBook",
    "StockSummary",
  ] as const),
  fromDate: Type.Optional(
    Type.String({ description: "Period start YYYY-MM-DD (defaults to books-from)." }),
  ),
  toDate: Type.Optional(
    Type.String({ description: "Period end YYYY-MM-DD (defaults to today)." }),
  ),
});

export function registerReportTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "tally_get_report",
    label: "Get Tally Report",
    description:
      "Fetch a built-in TallyPrime report. Supports Trial Balance, Day Book, Balance Sheet, Profit & Loss, Cash Book, Bank Book, and Stock Summary. Pass optional fromDate/toDate (YYYY-MM-DD) to scope the period.",
    promptSnippet:
      "Fetch a built-in Tally report (TrialBalance, DayBook, BalanceSheet, ProfitLoss, CashBook, BankBook, StockSummary) with optional date range",
    promptGuidelines: [
      "Use tally_get_report for any high-level financial overview question ('how are we doing', 'show me the P&L', 'trial balance for May').",
      "Always pass fromDate + toDate when the user mentions a period; do not assume the full books range.",
    ],
    parameters: REPORT_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const cfg = loadConfig(ctx.cwd);
      const client = new TallyClient({ url: cfg.url, timeoutMs: cfg.timeoutMs });
      const opts = {
        company: cfg.defaultCompany,
        fromDate: params.fromDate,
        toDate: params.toDate,
      };
      const report = params.report as ReportName;

      // Day Book gets a clean parser. Trial Balance gets a clean parser.
      // Others come back as raw report XML in v0.1 — flagged for v0.2 polish.
      if (report === "DayBook") {
        const body = await client.send(buildDayBookEnvelope({ ...opts, fromDate: params.fromDate ?? "1900-01-01", toDate: params.toDate ?? "2099-12-31" }));
        const rows = parseDayBook(body);
        const text = rows.length === 0
          ? "Day Book is empty for the requested period."
          : `Day Book — ${rows.length} voucher(s):\n` +
            rows
              .slice(0, 200)
              .map(
                (r) =>
                  `${r.date}  ${r.voucherType.padEnd(12)}  ${r.voucherNumber ?? "—"}  ${r.partyLedgerName ?? ""}  ${formatINR(r.amount)}`,
              )
              .join("\n") +
            (rows.length > 200 ? `\n… (${rows.length - 200} more)` : "");
        return { content: [{ type: "text", text }], details: { report: "DayBook", rows } };
      }

      if (report === "TrialBalance") {
        const body = await client.send(buildReportEnvelope("TrialBalance", opts));
        const rows = parseTrialBalance(body);
        const top = rows
          .slice(0, 100)
          .map((r) => {
            const side = r.debit > 0 ? `Dr ${formatINR(r.debit)}` : `Cr ${formatINR(r.credit)}`;
            return `${r.ledgerName.padEnd(40)} ${side}`;
          })
          .join("\n");
        const totalDr = rows.reduce((s, r) => s + r.debit, 0);
        const totalCr = rows.reduce((s, r) => s + r.credit, 0);
        return {
          content: [
            {
              type: "text",
              text:
                `Trial Balance (${rows.length} ledgers)\n` +
                top +
                (rows.length > 100 ? `\n… (${rows.length - 100} more)` : "") +
                `\n\nTotal Dr: ${formatINR(totalDr)}   Total Cr: ${formatINR(totalCr)}`,
            },
          ],
          details: { report: "TrialBalance", rows, totals: { dr: totalDr, cr: totalCr } },
        };
      }

      // Other reports: return raw XML for now, marked as v0.2 stub
      const body = await client.send(buildReportEnvelope(report, opts));
      return {
        content: [
          {
            type: "text",
            text:
              `Report '${report}' fetched (v0.2 will add a clean renderer).\n\n` +
              `Raw XML length: ${body.length} chars. Use tally_query_collection for structured access in the meantime.`,
          },
        ],
        details: { report, rawXmlLength: body.length },
      };
    },
  });
}
