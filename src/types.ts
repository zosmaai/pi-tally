/**
 * Domain types for TallyPrime entities.
 *
 * Kept deliberately minimal — only fields we actually read or render.
 * Add fields as new tools need them; do not bulk-add "just in case".
 */

export type Amount = number; // INR, always parsed to a JS number; precision handled at render
export type IsoDate = string; // "YYYY-MM-DD" — human-presentable
export type TallyDate = string; // "YYYYMMDD" — Tally wire format
export type Guid = string;

export interface CompanyInfo {
  name: string;
  reservedName?: string;
  startingFrom: IsoDate; // financial year start
  booksFrom: IsoDate; // earliest voucher date allowed
}

export interface GroupInfo {
  name: string;
  parent: string;
  primaryGroup?: string; // root group (Assets/Liabilities/Income/Expense)
  isRevenue?: boolean;
}

export interface LedgerInfo {
  name: string;
  parent: string; // group name
  alias?: string;
  openingBalance?: Amount;
  closingBalance?: Amount;
  isBilledWise?: boolean;
  gstRegistrationNumber?: string;
  gstRegistrationType?: GstRegistrationType;
  stateName?: string;
  email?: string;
  contactPerson?: string;
  ledgerPhone?: string;
}

export type GstRegistrationType =
  | "Regular"
  | "Composition"
  | "Consumer"
  | "Unregistered"
  | "Unknown";

export interface VoucherTypeInfo {
  name: string;
  parent: string; // e.g. "Sales", "Receipt", "Journal"
  numberingMethod?: string;
}

export type VoucherKind =
  | "Sales"
  | "Purchase"
  | "Receipt"
  | "Payment"
  | "Contra"
  | "Journal"
  | "Debit Note"
  | "Credit Note"
  | "Stock Journal"
  | "Manufacturing Journal"
  | "Other";

export interface LedgerEntry {
  ledgerName: string;
  /**
   * Tally convention: a positive amount on `LEDGERENTRIES.LIST` is a CREDIT,
   * a negative amount is a DEBIT (the opposite of accounting intuition).
   * Our type stores Tally's wire sign — UI rendering inverts when displaying Dr/Cr.
   */
  amount: Amount;
  isDeemedPositive?: boolean; // Tally's own Dr/Cr flag
  billAllocations?: BillAllocation[];
}

export interface BillAllocation {
  name: string; // bill reference / invoice number
  billType: "New Ref" | "Agst Ref" | "On Account" | "Advance";
  amount: Amount;
}

export interface VoucherInfo {
  guid?: Guid;
  date: IsoDate;
  voucherType: string;
  voucherNumber?: string;
  narration?: string;
  partyLedgerName?: string;
  referenceNumber?: string;
  referenceDate?: IsoDate;
  ledgerEntries: LedgerEntry[];
  isCancelled?: boolean;
  isOptional?: boolean;
}

export type ReportName =
  | "TrialBalance"
  | "DayBook"
  | "BalanceSheet"
  | "ProfitLoss"
  | "CashBook"
  | "BankBook"
  | "StockSummary";

export interface TrialBalanceRow {
  ledgerName: string;
  parent: string;
  opening: Amount;
  debit: Amount;
  credit: Amount;
  closing: Amount;
}

export interface DayBookRow {
  date: IsoDate;
  voucherType: string;
  voucherNumber?: string;
  partyLedgerName?: string;
  narration?: string;
  amount: Amount;
  guid?: Guid;
}

export interface OutstandingRow {
  partyLedgerName: string;
  billRef: string;
  billDate: IsoDate;
  dueDate?: IsoDate;
  amount: Amount;
  ageDays: number;
  ageBucket: "0-30" | "31-60" | "61-90" | "90+";
}

/**
 * Result of the authoritative `$$LicenseInfo` edition probe.
 * `supported: false` means Tally did not answer (old build) — treat as unknown.
 */
export interface LicenseProbe {
  supported: boolean;
  isEducationalMode?: boolean;
  isSilver?: boolean;
  isGold?: boolean;
  serialNumber?: string;
  accountId?: string;
}

export type TallyEdition = "Educational" | "Silver" | "Gold" | "Licensed" | "Unknown";

export interface HealthInfo {
  reachable: boolean;
  responseMs: number;
  bindAddress: "localhost-only" | "all-interfaces" | "unknown";
  productName?: string;
  productVersion?: string;
  /**
   * True ONLY when Tally's own $$LicenseInfo:IsEducationalMode returns Yes.
   * Never inferred from company names.
   */
  isEducationMode: boolean;
  /** Edition resolved from $$LicenseInfo, or "Unknown" if unavailable. */
  edition: TallyEdition;
  licenseSerial?: string;
  licenseAccountId?: string;
  companies: CompanyInfo[];
  activeCompany?: string;
  writeGates: WriteGateState;
}

export interface WriteGateState {
  masters: boolean;
  vouchers: boolean;
  bulkImport: boolean;
  rawXml: boolean;
}
