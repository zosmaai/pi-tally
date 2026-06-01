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
// Money on the wire
// --------------------------------------------------------------------------

/**
 * Format an INR amount for Tally's AMOUNT element. Always 2 decimals,
 * always plain ASCII (no ₹, no thousands separators). Sign included.
 */
export function tallyAmount(n: number): string {
  return n.toFixed(2);
}

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

// --------------------------------------------------------------------------
// Voucher posting (write)
// --------------------------------------------------------------------------

export type BillRefType = "On Account" | "Advance" | "Agst Ref" | "New Ref";

export interface PostReceiptInput {
  company: string;
  /** Customer / Sundry Debtor ledger. Will be CREDITED. */
  party: string;
  /** Cash or Bank ledger that receives the money. Will be DEBITED. */
  destinationLedger: string;
  /** ISO date YYYY-MM-DD. */
  date: string;
  /** Positive rupee amount. Anything <= 0 is a bug at the caller. */
  amount: number;
  /** Optional free-text narration. */
  narration?: string;
  /**
   * Optional bill reference. If supplied, attaches as `Agst Ref` (when
   * settling an existing bill) or `On Account` / `Advance` per Tally's
   * own classification. v0.2 ships only "On Account" — the planner-level
   * intelligence (matching outstanding bills) ships with the HTN in PR3+.
   */
  billRef?: { name: string; type: BillRefType };
}

export interface PostPaymentInput {
  company: string;
  /** Party being paid (Sundry Creditor / Debtor / Expense ledger). Will be DEBITED. */
  party: string;
  /** Cash or Bank ledger the money leaves from. Will be CREDITED. */
  sourceLedger: string;
  /** ISO date YYYY-MM-DD. */
  date: string;
  /** Positive rupee amount. */
  amount: number;
  /** Optional free-text narration. */
  narration?: string;
  /** Optional bill reference (e.g. "On Account" for advances/refunds, "Agst Ref" for settling a known bill). */
  billRef?: { name: string; type: BillRefType };
}

/**
 * Build a Receipt voucher import envelope.
 *
 * Tally voucher posting convention:
 *   - Cash/Bank (debited)  → ISDEEMEDPOSITIVE="Yes", AMOUNT negative
 *   - Party    (credited)  → ISDEEMEDPOSITIVE="No",  AMOUNT positive
 *
 * Voucher number is omitted so Tally auto-numbers per its own voucher-type
 * config. Caller decides idempotency separately.
 */
export function buildPostReceiptEnvelope(input: PostReceiptInput): string {
  if (!(input.amount > 0)) {
    throw new Error(`Receipt amount must be positive, got ${input.amount}`);
  }
  const date = toTallyDate(input.date);
  const amt = tallyAmount(input.amount);
  const negAmt = tallyAmount(-input.amount);
  const narration = input.narration ?? "";
  const billXml = input.billRef
    ? `      <BILLALLOCATIONS.LIST>
       <NAME>${xmlEscape(input.billRef.name)}</NAME>
       <BILLTYPE>${input.billRef.type}</BILLTYPE>
       <AMOUNT>${amt}</AMOUNT>
      </BILLALLOCATIONS.LIST>\n`
    : "";
  // ID="Vouchers" in the HEADER tells Tally which built-in import report
  // to run. Omitting it makes Tally silently return STATUS=0 with empty
  // BODY — no LINEERROR, no ERRORMSG. Cost us an hour the first time.
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Import</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>Vouchers</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVCURRENTCOMPANY>${xmlEscape(input.company)}</SVCURRENTCOMPANY>
   </STATICVARIABLES>
  </DESC>
  <DATA>
   <TALLYMESSAGE xmlns:UDF="TallyUDF">
    <VOUCHER VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View">
     <DATE>${date}</DATE>
     <EFFECTIVEDATE>${date}</EFFECTIVEDATE>
     <NARRATION>${xmlEscape(narration)}</NARRATION>
     <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
     <PARTYLEDGERNAME>${xmlEscape(input.party)}</PARTYLEDGERNAME>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${xmlEscape(input.party)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>${amt}</AMOUNT>
${billXml}     </ALLLEDGERENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${xmlEscape(input.destinationLedger)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>${negAmt}</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
    </VOUCHER>
   </TALLYMESSAGE>
  </DATA>
 </BODY>
</ENVELOPE>`;
}

/**
 * Build a Payment voucher import envelope. The mirror of
 * `buildPostReceiptEnvelope` with Dr/Cr sides swapped.
 *
 * Tally Payment convention:
 *   - Party    (debited)   → ISDEEMEDPOSITIVE="Yes", AMOUNT negative
 *   - Cash/Bank (credited) → ISDEEMEDPOSITIVE="No",  AMOUNT positive
 *
 * Use cases:
 *   - Paying a vendor (Sundry Creditor)
 *   - Refunding a customer (Sundry Debtor as party)
 *   - Posting a reversal of an earlier Receipt
 */
export function buildPostPaymentEnvelope(input: PostPaymentInput): string {
  if (!(input.amount > 0)) {
    throw new Error(`Payment amount must be positive, got ${input.amount}`);
  }
  const date = toTallyDate(input.date);
  const amt = tallyAmount(input.amount);
  const negAmt = tallyAmount(-input.amount);
  const narration = input.narration ?? "";
  // Bill allocation amount mirrors the party side (negative on payment).
  const billXml = input.billRef
    ? `      <BILLALLOCATIONS.LIST>
       <NAME>${xmlEscape(input.billRef.name)}</NAME>
       <BILLTYPE>${input.billRef.type}</BILLTYPE>
       <AMOUNT>${negAmt}</AMOUNT>
      </BILLALLOCATIONS.LIST>\n`
    : "";
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Import</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>Vouchers</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVCURRENTCOMPANY>${xmlEscape(input.company)}</SVCURRENTCOMPANY>
   </STATICVARIABLES>
  </DESC>
  <DATA>
   <TALLYMESSAGE xmlns:UDF="TallyUDF">
    <VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View">
     <DATE>${date}</DATE>
     <EFFECTIVEDATE>${date}</EFFECTIVEDATE>
     <NARRATION>${xmlEscape(narration)}</NARRATION>
     <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
     <PARTYLEDGERNAME>${xmlEscape(input.party)}</PARTYLEDGERNAME>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${xmlEscape(input.party)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>${negAmt}</AMOUNT>
${billXml}     </ALLLEDGERENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${xmlEscape(input.sourceLedger)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>${amt}</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
    </VOUCHER>
   </TALLYMESSAGE>
  </DATA>
 </BODY>
</ENVELOPE>`;
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
