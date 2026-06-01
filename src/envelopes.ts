/**
 * Pure envelope builders.
 *
 * Each exported function returns a complete XML string ready to POST to the
 * Tally gateway. No I/O, no side effects — fully unit-testable.
 *
 * Envelope shapes transcribed from:
 *   - help.tallysolutions.com/developer-reference/integration-using-xml-interface/
 *   - github.com/NoumaanAhamed/tally-prime-api-docs
 *
 * Naming convention: `build<RequestKind>Envelope(...)`. Every builder takes
 * a typed options object so callers stay explicit.
 */

import type { ReportName } from "./types.js";

// --------------------------------------------------------------------------
// XML primitives
// --------------------------------------------------------------------------

/**
 * Escape special characters for XML element content / attribute values.
 * Tally tolerates raw `&` in many places but breaks on `<` and `>` and
 * inconsistently on apostrophes inside company names. Be strict.
 */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Tally wire date format: YYYYMMDD. Accepts ISO (YYYY-MM-DD) or already-wire. */
export function toTallyDate(date: string): string {
  if (/^\d{8}$/.test(date)) return date;
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    throw new Error(`Invalid date "${date}". Expected YYYY-MM-DD or YYYYMMDD.`);
  }
  return `${m[1]}${m[2]}${m[3]}`;
}

interface StaticVars {
  /** Active company to scope this request. If omitted, Tally uses its current active company. */
  company?: string;
  fromDate?: string; // YYYY-MM-DD or YYYYMMDD
  toDate?: string;
  exportFormat?: "XML" | "JSON";
}

function renderStaticVars(vars: StaticVars): string {
  const lines: string[] = [];
  const fmt = vars.exportFormat ?? "XML";
  lines.push(`     <SVEXPORTFORMAT>$$SysName:${fmt}</SVEXPORTFORMAT>`);
  if (vars.company) {
    lines.push(`     <SVCURRENTCOMPANY>${xmlEscape(vars.company)}</SVCURRENTCOMPANY>`);
  }
  if (vars.fromDate) {
    lines.push(`     <SVFROMDATE TYPE="Date">${toTallyDate(vars.fromDate)}</SVFROMDATE>`);
  }
  if (vars.toDate) {
    lines.push(`     <SVTODATE TYPE="Date">${toTallyDate(vars.toDate)}</SVTODATE>`);
  }
  return lines.join("\n");
}

// --------------------------------------------------------------------------
// Builders
// --------------------------------------------------------------------------

/** Probe: list loaded companies. Doubles as a reachability test. */
export function buildListCompaniesEnvelope(): string {
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>List of Companies</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
${renderStaticVars({ exportFormat: "XML" })}
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="List of Companies" ISMODIFY="No">
      <TYPE>Company</TYPE>
      <FETCH>Name, StartingFrom, BooksFrom</FETCH>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

export interface ListLedgersOptions extends StaticVars {
  /** Optional name pattern filter. Applied client-side; Tally has no LIKE. */
  // (Filtering happens after parse; kept here for caller documentation only.)
}

export function buildListLedgersEnvelope(opts: ListLedgersOptions = {}): string {
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>List of Ledgers</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
${renderStaticVars(opts)}
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="List of Ledgers" ISMODIFY="No">
      <TYPE>Ledger</TYPE>
      <FETCH>Name, Parent, OpeningBalance, ClosingBalance, LedgerPhone, Email, GSTRegistrationType, PartyGSTIN, StateName</FETCH>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

export function buildListGroupsEnvelope(opts: StaticVars = {}): string {
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>List of Groups</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
${renderStaticVars(opts)}
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="List of Groups" ISMODIFY="No">
      <TYPE>Group</TYPE>
      <FETCH>Name, Parent, IsRevenue, PrimaryGroup</FETCH>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

export function buildListVoucherTypesEnvelope(opts: StaticVars = {}): string {
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>List of VoucherTypes</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
${renderStaticVars(opts)}
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="List of VoucherTypes" ISMODIFY="No">
      <TYPE>VoucherType</TYPE>
      <FETCH>Name, Parent, NumberingMethod</FETCH>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

export interface ListVouchersOptions extends StaticVars {
  /** Required: pin the result set with a date range. */
  fromDate: string;
  toDate: string;
}

/**
 * Day Book is the canonical "all vouchers between two dates" report.
 * Filtering by voucher type / ledger is applied client-side after parse.
 */
export function buildDayBookEnvelope(opts: ListVouchersOptions): string {
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>Day Book</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
${renderStaticVars(opts)}
   </STATICVARIABLES>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

/** Built-in named report. ID is the Tally menu name. */
export function buildReportEnvelope(report: ReportName, opts: StaticVars = {}): string {
  const idMap: Record<ReportName, string> = {
    TrialBalance: "Trial Balance",
    DayBook: "Day Book",
    BalanceSheet: "Balance Sheet",
    ProfitLoss: "Profit and Loss",
    CashBook: "Cash Book",
    BankBook: "Bank Book",
    StockSummary: "Stock Summary",
  };
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>${idMap[report]}</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
${renderStaticVars(opts)}
   </STATICVARIABLES>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

export interface RawCollectionOptions extends StaticVars {
  collectionName: string;
  type: string; // e.g. "Ledger", "Voucher", "StockItem"
  fetch?: string[]; // field list
}

/** Power-user escape hatch for arbitrary collections. */
export function buildRawCollectionEnvelope(opts: RawCollectionOptions): string {
  const fetchLine = opts.fetch?.length ? `      <FETCH>${opts.fetch.join(", ")}</FETCH>` : "";
  const name = xmlEscape(opts.collectionName);
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>${name}</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
${renderStaticVars(opts)}
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="${name}" ISMODIFY="No">
      <TYPE>${xmlEscape(opts.type)}</TYPE>
${fetchLine}
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
}
