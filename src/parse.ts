/**
 * XML response parsers.
 *
 * Tally's XML is deeply nested, attribute-heavy, and inconsistent between
 * report types. We deliberately use **regex-based parsing** for the small,
 * well-known shapes we ship in v1 instead of pulling in a full XML parser:
 *
 *   - Zero dependencies (peerDependencies-only at runtime)
 *   - The shapes are fixed and stable
 *   - We control the envelopes, so we know exactly what to expect back
 *
 * If shapes get complex in v2 (vouchers with nested inventory + tax lines),
 * we'll swap in `fast-xml-parser` as a peer dep. Not before.
 *
 * All parsers are defensive: missing fields default to undefined/0,
 * never throw. Errors are surfaced via parseTallyError().
 */

import type {
  CompanyInfo,
  DayBookRow,
  GroupInfo,
  LedgerInfo,
  TrialBalanceRow,
  VoucherTypeInfo,
  GstRegistrationType,
} from "./types.js";

// --------------------------------------------------------------------------
// Low-level helpers
// --------------------------------------------------------------------------

/** Tally XML returns dates as `YYYYMMDD`. Convert to ISO `YYYY-MM-DD`. */
export function tallyDateToIso(tallyDate: string): string {
  const m = tallyDate.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return tallyDate;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Parse a Tally amount string. Strips signs and whitespace; returns 0 if blank. */
export function parseTallyAmount(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/[,\s₹]/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Decode entity-escaped attribute strings back to plain text. */
export function decodeXmlText(s: string): string {
  return s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

/**
 * Extract the inner text of the first `<TAG>...</TAG>` (case-insensitive on tag name).
 * Returns `undefined` if not found. Strips leading/trailing whitespace.
 */
export function extractTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? decodeXmlText(m[1]!.trim()) : undefined;
}

/** Extract the `NAME="..."` attribute from the opening tag of `tag`. */
export function extractNameAttr(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}\\s+[^>]*\\bNAME="([^"]*)"`, "i");
  const m = block.match(re);
  return m ? decodeXmlText(m[1]!) : undefined;
}

/**
 * Iterate over `<TAG ...>...</TAG>` blocks in document order.
 * Yields the entire matched block including the opening + closing tags so
 * the caller can extract attributes and inner tags.
 */
export function* iterBlocks(xml: string, tag: string): Generator<string> {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "gi");
  for (const m of xml.matchAll(re)) yield m[0];
}

// --------------------------------------------------------------------------
// Error surfacing
// --------------------------------------------------------------------------

export interface TallyError {
  kind: "request" | "response" | "lineerror";
  message: string;
  raw?: string;
}

/**
 * Detect Tally's various error shapes:
 *   - <ERRORMSG>...</ERRORMSG>          generic gateway error
 *   - <LINEERROR>...</LINEERROR>        per-line import error
 *   - <RESPONSE> wrapper with EXCEPTIONS > 0
 */
export function parseTallyError(xml: string): TallyError | null {
  const errMsg = extractTag(xml, "ERRORMSG");
  if (errMsg) return { kind: "response", message: errMsg, raw: xml };

  const lineErr = extractTag(xml, "LINEERROR");
  if (lineErr) return { kind: "lineerror", message: lineErr, raw: xml };

  const created = extractTag(xml, "CREATED");
  const errors = extractTag(xml, "ERRORS");
  if (errors && parseTallyAmount(errors) > 0 && parseTallyAmount(created) === 0) {
    const reason =
      extractTag(xml, "EXCEPTIONS") ?? "Import reported errors with no objects created";
    return { kind: "response", message: reason, raw: xml };
  }

  return null;
}

// --------------------------------------------------------------------------
// Companies
// --------------------------------------------------------------------------

export function parseCompanies(xml: string): CompanyInfo[] {
  const out: CompanyInfo[] = [];
  for (const block of iterBlocks(xml, "COMPANY")) {
    const name = extractNameAttr(block, "COMPANY");
    if (!name) continue;
    const reservedMatch = block.match(/RESERVEDNAME="([^"]*)"/i);
    const startingFrom = extractTag(block, "STARTINGFROM");
    const booksFrom = extractTag(block, "BOOKSFROM");
    out.push({
      name,
      reservedName: reservedMatch?.[1] ? decodeXmlText(reservedMatch[1]) : undefined,
      startingFrom: startingFrom ? tallyDateToIso(startingFrom) : "",
      booksFrom: booksFrom ? tallyDateToIso(booksFrom) : "",
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Ledgers
// --------------------------------------------------------------------------

function parseGstRegistrationType(raw: string | undefined): GstRegistrationType {
  if (!raw) return "Unknown";
  const v = raw.trim();
  if (v === "Regular" || v === "Composition" || v === "Consumer" || v === "Unregistered") {
    return v;
  }
  return "Unknown";
}

export function parseLedgers(xml: string): LedgerInfo[] {
  const out: LedgerInfo[] = [];
  for (const block of iterBlocks(xml, "LEDGER")) {
    const name = extractNameAttr(block, "LEDGER");
    if (!name) continue;
    const parent = extractTag(block, "PARENT") ?? "";
    const opening = extractTag(block, "OPENINGBALANCE");
    const closing = extractTag(block, "CLOSINGBALANCE");
    const phone = extractTag(block, "LEDGERPHONE");
    const email = extractTag(block, "EMAIL");
    const gstinAttr = extractTag(block, "PARTYGSTIN");
    const gstType = extractTag(block, "GSTREGISTRATIONTYPE");
    const stateName = extractTag(block, "STATENAME");
    out.push({
      name,
      parent,
      openingBalance: opening !== undefined ? parseTallyAmount(opening) : undefined,
      closingBalance: closing !== undefined ? parseTallyAmount(closing) : undefined,
      ledgerPhone: phone,
      email,
      gstRegistrationNumber: gstinAttr,
      gstRegistrationType: parseGstRegistrationType(gstType),
      stateName,
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Groups
// --------------------------------------------------------------------------

export function parseGroups(xml: string): GroupInfo[] {
  const out: GroupInfo[] = [];
  for (const block of iterBlocks(xml, "GROUP")) {
    const name = extractNameAttr(block, "GROUP");
    if (!name) continue;
    out.push({
      name,
      parent: extractTag(block, "PARENT") ?? "",
      primaryGroup: extractTag(block, "PRIMARYGROUP"),
      isRevenue: extractTag(block, "ISREVENUE") === "Yes",
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Voucher types
// --------------------------------------------------------------------------

export function parseVoucherTypes(xml: string): VoucherTypeInfo[] {
  const out: VoucherTypeInfo[] = [];
  for (const block of iterBlocks(xml, "VOUCHERTYPE")) {
    const name = extractNameAttr(block, "VOUCHERTYPE");
    if (!name) continue;
    out.push({
      name,
      parent: extractTag(block, "PARENT") ?? "",
      numberingMethod: extractTag(block, "NUMBERINGMETHOD"),
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Day Book
// --------------------------------------------------------------------------

/**
 * Day Book response is a fully-rendered report shape, not a clean collection.
 * Each voucher is a <VOUCHER REMOTEID="...">...</VOUCHER> block.
 */
export function parseDayBook(xml: string): DayBookRow[] {
  const out: DayBookRow[] = [];
  for (const block of iterBlocks(xml, "VOUCHER")) {
    const date = extractTag(block, "DATE");
    const voucherType = extractTag(block, "VOUCHERTYPENAME");
    if (!date || !voucherType) continue;
    const voucherNumber = extractTag(block, "VOUCHERNUMBER");
    const party = extractTag(block, "PARTYLEDGERNAME") ?? extractTag(block, "PARTYNAME");
    const narration = extractTag(block, "NARRATION");
    const amount = extractTag(block, "AMOUNT");
    const guidAttr = block.match(/REMOTEID="([^"]+)"/i)?.[1];
    out.push({
      date: tallyDateToIso(date),
      voucherType,
      voucherNumber,
      partyLedgerName: party,
      narration,
      amount: parseTallyAmount(amount),
      guid: guidAttr ? decodeXmlText(guidAttr) : undefined,
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Trial Balance
// --------------------------------------------------------------------------

/**
 * Trial Balance is a tree of `<DSPACCNAME>/<DSPACCINFO>` rows under group
 * headers. We flatten to ledger-level rows; group totals are skipped because
 * they're derivable client-side.
 */
export function parseTrialBalance(xml: string): TrialBalanceRow[] {
  const out: TrialBalanceRow[] = [];

  // Modern TallyPrime: <DSPACCNAME><DSPDISPNAME>Ledger</DSPDISPNAME></DSPACCNAME>
  //                   <DSPACCINFO><DSPCLDRAMT>...</DSPCLDRAMT>...</DSPACCINFO>
  // We pair adjacent name+info blocks.

  const namePattern = /<DSPACCNAME>[\s\S]*?<DSPDISPNAME>([\s\S]*?)<\/DSPDISPNAME>[\s\S]*?<\/DSPACCNAME>/gi;
  const matches = [...xml.matchAll(namePattern)];
  const infoBlocks = [...iterBlocks(xml, "DSPACCINFO")];

  for (let i = 0; i < matches.length && i < infoBlocks.length; i++) {
    const ledgerName = decodeXmlText(matches[i]![1]!.trim());
    const info = infoBlocks[i]!;

    const debit = parseTallyAmount(extractTag(info, "DSPCLDRAMT"));
    const credit = parseTallyAmount(extractTag(info, "DSPCLCRAMT"));
    const opening = parseTallyAmount(
      extractTag(info, "DSPOPDRAMT") ?? extractTag(info, "DSPOPCRAMT") ?? "0",
    );
    // Closing = debit - credit (Tally renders the side, not the signed value)
    const closing = debit - credit;

    out.push({
      ledgerName,
      parent: "", // Trial Balance flat view doesn't carry parent
      opening,
      debit,
      credit,
      closing,
    });
  }

  return out;
}
