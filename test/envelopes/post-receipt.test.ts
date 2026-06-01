/**
 * Envelope shape tests for buildPostReceiptEnvelope.
 *
 * The Tally gateway is unforgiving: a missing element, wrong sign, or
 * mis-cased tag returns LINEERROR with no useful detail. These tests
 * lock the wire shape so we notice the moment something drifts.
 *
 * We assert structural invariants, not literal byte-equality, so
 * cosmetic reformats don't break the suite.
 */

import { describe, expect, it } from "vitest";
import {
  buildPostReceiptEnvelope,
  tallyAmount,
  toTallyDate,
} from "../../src/envelopes.js";

describe("tallyAmount", () => {
  it("always renders 2 decimals, no separators, no symbol", () => {
    expect(tallyAmount(1)).toBe("1.00");
    expect(tallyAmount(1234567.5)).toBe("1234567.50");
    expect(tallyAmount(-50)).toBe("-50.00");
  });
});

describe("toTallyDate", () => {
  it("converts ISO YYYY-MM-DD to Tally YYYYMMDD", () => {
    expect(toTallyDate("2026-06-01")).toBe("20260601");
  });
  it("passes through already-wire dates", () => {
    expect(toTallyDate("20260601")).toBe("20260601");
  });
  it("throws on garbage", () => {
    expect(() => toTallyDate("yesterday")).toThrow();
    expect(() => toTallyDate("01-06-2026")).toThrow();
  });
});

describe("buildPostReceiptEnvelope", () => {
  const base = {
    company: "ZOSMAAI SOLUTIONS PRIVATE LIMITED",
    party: "FOODSTORIES PRIVATE LIMITED",
    destinationLedger: "Cash",
    date: "2026-06-01",
    amount: 1,
    narration: "pi-tally smoke test",
  };

  it("wraps an Import / Data envelope (not Export / Collection)", () => {
    const xml = buildPostReceiptEnvelope(base);
    expect(xml).toContain("<TALLYREQUEST>Import</TALLYREQUEST>");
    expect(xml).toContain("<TYPE>Data</TYPE>");
    expect(xml).not.toContain("Export");
  });

  it("includes <ID>Vouchers</ID> in the HEADER (Tally requires it for voucher imports)", () => {
    // Without this, Tally silently returns STATUS=0 with no LINEERROR.
    const xml = buildPostReceiptEnvelope(base);
    expect(xml).toMatch(/<HEADER>[\s\S]*<ID>Vouchers<\/ID>[\s\S]*<\/HEADER>/);
  });

  it("scopes to the right SVCURRENTCOMPANY", () => {
    const xml = buildPostReceiptEnvelope(base);
    expect(xml).toContain("<SVCURRENTCOMPANY>ZOSMAAI SOLUTIONS PRIVATE LIMITED</SVCURRENTCOMPANY>");
  });

  it("uses VCHTYPE=Receipt and matching VOUCHERTYPENAME", () => {
    const xml = buildPostReceiptEnvelope(base);
    expect(xml).toMatch(/<VOUCHER\s+[^>]*VCHTYPE="Receipt"/);
    expect(xml).toContain("<VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>");
  });

  it("emits exactly two ALLLEDGERENTRIES.LIST blocks", () => {
    const xml = buildPostReceiptEnvelope(base);
    const matches = xml.match(/<ALLLEDGERENTRIES\.LIST>/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it("party block is the credit side (ISDEEMEDPOSITIVE=No, positive amount)", () => {
    const xml = buildPostReceiptEnvelope({ ...base, amount: 1500 });
    // Find party block
    const partyBlock = xml.split("<ALLLEDGERENTRIES.LIST>")[1]!;
    expect(partyBlock).toContain("<LEDGERNAME>FOODSTORIES PRIVATE LIMITED</LEDGERNAME>");
    expect(partyBlock).toContain("<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>");
    expect(partyBlock).toContain("<AMOUNT>1500.00</AMOUNT>");
  });

  it("destination (cash/bank) block is the debit side (ISDEEMEDPOSITIVE=Yes, negative amount)", () => {
    const xml = buildPostReceiptEnvelope({ ...base, amount: 1500 });
    const dest = xml.split("<ALLLEDGERENTRIES.LIST>")[2]!;
    expect(dest).toContain("<LEDGERNAME>Cash</LEDGERNAME>");
    expect(dest).toContain("<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>");
    expect(dest).toContain("<AMOUNT>-1500.00</AMOUNT>");
  });

  it("PARTYLEDGERNAME at the voucher level matches the party block", () => {
    const xml = buildPostReceiptEnvelope(base);
    expect(xml).toContain("<PARTYLEDGERNAME>FOODSTORIES PRIVATE LIMITED</PARTYLEDGERNAME>");
  });

  it("DATE and EFFECTIVEDATE both in YYYYMMDD form", () => {
    const xml = buildPostReceiptEnvelope(base);
    expect(xml).toContain("<DATE>20260601</DATE>");
    expect(xml).toContain("<EFFECTIVEDATE>20260601</EFFECTIVEDATE>");
  });

  it("does NOT emit a VOUCHERNUMBER element (Tally must auto-number)", () => {
    const xml = buildPostReceiptEnvelope(base);
    expect(xml).not.toContain("<VOUCHERNUMBER>");
  });

  it("xml-escapes party names containing & or '", () => {
    const xml = buildPostReceiptEnvelope({
      ...base,
      party: "Acme & Co's Pvt Ltd",
    });
    expect(xml).toContain("Acme &amp; Co&apos;s Pvt Ltd");
    expect(xml).not.toContain("Acme & Co's");
  });

  it("omits bill allocation block when no billRef is supplied", () => {
    const xml = buildPostReceiptEnvelope(base);
    expect(xml).not.toContain("<BILLALLOCATIONS.LIST>");
  });

  it("emits one bill allocation block when billRef is supplied", () => {
    const xml = buildPostReceiptEnvelope({
      ...base,
      billRef: { name: "INV-2025-014", type: "Agst Ref" },
    });
    const blocks = xml.match(/<BILLALLOCATIONS\.LIST>/g) ?? [];
    expect(blocks).toHaveLength(1);
    expect(xml).toContain("<NAME>INV-2025-014</NAME>");
    expect(xml).toContain("<BILLTYPE>Agst Ref</BILLTYPE>");
  });

  it("rejects zero or negative amounts at build time (defense in depth)", () => {
    expect(() => buildPostReceiptEnvelope({ ...base, amount: 0 })).toThrow();
    expect(() => buildPostReceiptEnvelope({ ...base, amount: -10 })).toThrow();
    expect(() => buildPostReceiptEnvelope({ ...base, amount: Number.NaN })).toThrow();
  });
});
