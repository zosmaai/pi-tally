/**
 * Envelope shape tests for buildPostPaymentEnvelope.
 *
 * Payment is the mirror of Receipt:
 *   - Receipt:  Cash/Bank Dr (ISDEEMEDPOSITIVE=Yes, neg amount)
 *               Party     Cr (ISDEEMEDPOSITIVE=No,  pos amount)
 *   - Payment:  Party     Dr (ISDEEMEDPOSITIVE=Yes, neg amount)
 *               Cash/Bank Cr (ISDEEMEDPOSITIVE=No,  pos amount)
 *
 * Same wire-level invariants as receipt (Vouchers ID in HEADER, no
 * VOUCHERNUMBER, XML escaping, etc.) — locked here so we notice any drift.
 */

import { describe, expect, it } from "vitest";
import { buildPostPaymentEnvelope } from "../../src/envelopes.js";

describe("buildPostPaymentEnvelope", () => {
  const base = {
    company: "ZOSMAAI SOLUTIONS PRIVATE LIMITED",
    party: "FOODSTORIES PRIVATE LIMITED",
    sourceLedger: "Cash",
    date: "2026-06-01",
    amount: 1,
    narration: "test refund",
  };

  it("wraps an Import / Data envelope with <ID>Vouchers</ID>", () => {
    const xml = buildPostPaymentEnvelope(base);
    expect(xml).toContain("<TALLYREQUEST>Import</TALLYREQUEST>");
    expect(xml).toContain("<TYPE>Data</TYPE>");
    expect(xml).toMatch(/<HEADER>[\s\S]*<ID>Vouchers<\/ID>[\s\S]*<\/HEADER>/);
  });

  it("uses VCHTYPE=Payment and matching VOUCHERTYPENAME", () => {
    const xml = buildPostPaymentEnvelope(base);
    expect(xml).toMatch(/<VOUCHER\s+[^>]*VCHTYPE="Payment"/);
    expect(xml).toContain("<VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>");
  });

  it("party block is DEBIT side (ISDEEMEDPOSITIVE=Yes, negative amount) — mirror of receipt", () => {
    const xml = buildPostPaymentEnvelope({ ...base, amount: 1500 });
    const partyBlock = xml.split("<ALLLEDGERENTRIES.LIST>")[1]!;
    expect(partyBlock).toContain("<LEDGERNAME>FOODSTORIES PRIVATE LIMITED</LEDGERNAME>");
    expect(partyBlock).toContain("<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>");
    expect(partyBlock).toContain("<AMOUNT>-1500.00</AMOUNT>");
  });

  it("source (cash/bank) block is CREDIT side (ISDEEMEDPOSITIVE=No, positive amount)", () => {
    const xml = buildPostPaymentEnvelope({ ...base, amount: 1500 });
    const sourceBlock = xml.split("<ALLLEDGERENTRIES.LIST>")[2]!;
    expect(sourceBlock).toContain("<LEDGERNAME>Cash</LEDGERNAME>");
    expect(sourceBlock).toContain("<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>");
    expect(sourceBlock).toContain("<AMOUNT>1500.00</AMOUNT>");
  });

  it("PARTYLEDGERNAME at voucher level matches the party block", () => {
    const xml = buildPostPaymentEnvelope(base);
    expect(xml).toContain("<PARTYLEDGERNAME>FOODSTORIES PRIVATE LIMITED</PARTYLEDGERNAME>");
  });

  it("DATE and EFFECTIVEDATE both YYYYMMDD", () => {
    const xml = buildPostPaymentEnvelope(base);
    expect(xml).toContain("<DATE>20260601</DATE>");
    expect(xml).toContain("<EFFECTIVEDATE>20260601</EFFECTIVEDATE>");
  });

  it("does NOT emit VOUCHERNUMBER (auto-number)", () => {
    expect(buildPostPaymentEnvelope(base)).not.toContain("<VOUCHERNUMBER>");
  });

  it("xml-escapes party names", () => {
    const xml = buildPostPaymentEnvelope({ ...base, party: "Acme & Co's Pvt Ltd" });
    expect(xml).toContain("Acme &amp; Co&apos;s Pvt Ltd");
  });

  it("emits a bill allocation block when billRef is supplied (mirrors party debit sign)", () => {
    const xml = buildPostPaymentEnvelope({
      ...base,
      amount: 1500,
      billRef: { name: "REVERSAL-RV-2", type: "On Account" },
    });
    expect(xml).toContain("<BILLALLOCATIONS.LIST>");
    expect(xml).toContain("<NAME>REVERSAL-RV-2</NAME>");
    expect(xml).toContain("<BILLTYPE>On Account</BILLTYPE>");
    // The bill allocation amount must match the party side (negative for payment)
    const bill = xml.split("<BILLALLOCATIONS.LIST>")[1]!.split("</BILLALLOCATIONS.LIST>")[0]!;
    expect(bill).toContain("<AMOUNT>-1500.00</AMOUNT>");
  });

  it("rejects zero/negative amounts at build time", () => {
    expect(() => buildPostPaymentEnvelope({ ...base, amount: 0 })).toThrow();
    expect(() => buildPostPaymentEnvelope({ ...base, amount: -10 })).toThrow();
    expect(() => buildPostPaymentEnvelope({ ...base, amount: Number.NaN })).toThrow();
  });
});
